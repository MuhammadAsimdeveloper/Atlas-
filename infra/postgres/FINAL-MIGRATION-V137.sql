-- Atlas V137: durable observability, SLO evaluation, alert and incident control plane.
BEGIN;

CREATE TABLE IF NOT EXISTS atlas_runtime_slo_policies (
 policy_id TEXT PRIMARY KEY,
 metric TEXT NOT NULL CHECK(metric IN ('queue_latency_ms','job_duration_ms','error_rate','success_rate','lease_recovery_rate')),
 window_seconds INTEGER NOT NULL CHECK(window_seconds BETWEEN 60 AND 86400),
 target NUMERIC NOT NULL CHECK(target >= 0),
 allowed_bad_ratio NUMERIC NOT NULL CHECK(allowed_bad_ratio >= 0 AND allowed_bad_ratio <= 1),
 warning_bad_ratio NUMERIC NOT NULL CHECK(warning_bad_ratio >= 0 AND warning_bad_ratio <= 1),
 critical_bad_ratio NUMERIC NOT NULL CHECK(critical_bad_ratio >= 0 AND critical_bad_ratio <= 1),
 enabled BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(warning_bad_ratio <= critical_bad_ratio)
);

CREATE TABLE IF NOT EXISTS atlas_runtime_slo_evaluations (
 evaluation_id UUID PRIMARY KEY,
 policy_id TEXT NOT NULL REFERENCES atlas_runtime_slo_policies(policy_id) ON DELETE CASCADE,
 pool_id TEXT NOT NULL REFERENCES atlas_runtime_pools(pool_id) ON DELETE CASCADE,
 window_start TIMESTAMPTZ NOT NULL,
 window_end TIMESTAMPTZ NOT NULL,
 sample_count INTEGER NOT NULL CHECK(sample_count >= 0),
 good_count INTEGER NOT NULL CHECK(good_count >= 0 AND good_count <= sample_count),
 bad_ratio NUMERIC NOT NULL CHECK(bad_ratio >= 0 AND bad_ratio <= 1),
 observed_value NUMERIC,
 error_budget_remaining NUMERIC NOT NULL CHECK(error_budget_remaining >= 0 AND error_budget_remaining <= 1),
 status TEXT NOT NULL CHECK(status IN ('no_data','ok','warning','critical')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_runtime_slo_evaluations_lookup ON atlas_runtime_slo_evaluations(policy_id,pool_id,created_at DESC);

CREATE TABLE IF NOT EXISTS atlas_runtime_alerts (
 alert_id TEXT PRIMARY KEY,
 fingerprint TEXT NOT NULL UNIQUE,
 policy_id TEXT NOT NULL REFERENCES atlas_runtime_slo_policies(policy_id) ON DELETE CASCADE,
 pool_id TEXT NOT NULL REFERENCES atlas_runtime_pools(pool_id) ON DELETE CASCADE,
 severity TEXT NOT NULL CHECK(severity IN ('warning','critical')),
 status TEXT NOT NULL CHECK(status IN ('open','acknowledged','resolved')),
 current_value NUMERIC,
 threshold NUMERIC NOT NULL,
 first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 acknowledged_at TIMESTAMPTZ,
 resolved_at TIMESTAMPTZ,
 CHECK(resolved_at IS NULL OR status='resolved')
);
CREATE INDEX IF NOT EXISTS idx_atlas_runtime_alerts_active ON atlas_runtime_alerts(pool_id,status,last_seen_at DESC);

CREATE TABLE IF NOT EXISTS atlas_runtime_incidents (
 incident_id UUID PRIMARY KEY,
 fingerprint TEXT NOT NULL UNIQUE,
 severity TEXT NOT NULL CHECK(severity IN ('warning','critical')),
 status TEXT NOT NULL CHECK(status IN ('open','resolved')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
 opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_atlas_runtime_incidents_active ON atlas_runtime_incidents(status,opened_at DESC);

INSERT INTO atlas_runtime_slo_policies(policy_id,metric,window_seconds,target,allowed_bad_ratio,warning_bad_ratio,critical_bad_ratio)
VALUES
 ('runtime.queue-latency','queue_latency_ms',300,1000,0.05,0.10,0.20),
 ('runtime.job-duration','job_duration_ms',300,30000,0.05,0.10,0.20),
 ('runtime.error-rate','error_rate',300,0.01,0.05,0.10,0.20),
 ('runtime.success-rate','success_rate',300,0.995,0.05,0.10,0.20),
 ('runtime.lease-recovery','lease_recovery_rate',300,0.99,0.05,0.10,0.20)
ON CONFLICT(policy_id) DO NOTHING;

CREATE OR REPLACE FUNCTION atlas_v137_evaluate_runtime_slo(p_policy_id TEXT,p_pool_id TEXT,p_evaluation_id UUID)
RETURNS TABLE(status TEXT,bad_ratio NUMERIC,observed_value NUMERIC,error_budget_remaining NUMERIC,alert_id TEXT,incident_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 policy atlas_runtime_slo_policies%ROWTYPE;
 sample_count INTEGER := 0;
 good_count INTEGER := 0;
 bad_ratio NUMERIC := 0;
 observed NUMERIC;
 evaluation_status TEXT := 'no_data';
 alert_key TEXT := md5(p_policy_id || ':' || p_pool_id);
 incident_key TEXT := md5('incident:' || p_policy_id || ':' || p_pool_id);
 budget NUMERIC := 1;
 alert_severity TEXT;
 incident_uuid UUID;
BEGIN
 SELECT * INTO policy FROM atlas_runtime_slo_policies WHERE policy_id=p_policy_id AND enabled=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'slo_policy_not_found'; END IF;
 SELECT count(*)::integer,avg(s.value),count(*) FILTER (WHERE CASE WHEN s.metric IN ('success_rate','lease_recovery_rate') THEN s.value >= policy.target ELSE s.value <= policy.target END)::integer
 INTO sample_count,observed,good_count
 FROM atlas_runtime_slo_samples s
 WHERE s.pool_id=p_pool_id AND s.metric=policy.metric AND s.observed_at >= now()-make_interval(secs=>policy.window_seconds) AND s.observed_at <= now();
 IF sample_count > 0 THEN
   bad_ratio := greatest(0,least(1,1-(good_count::numeric/sample_count::numeric)));
   budget := greatest(0,least(1,1-(bad_ratio/greatest(policy.allowed_bad_ratio,0.000001))));
   IF bad_ratio >= policy.critical_bad_ratio THEN evaluation_status := 'critical';
   ELSIF bad_ratio >= policy.warning_bad_ratio THEN evaluation_status := 'warning';
   ELSE evaluation_status := 'ok'; END IF;
 END IF;
 INSERT INTO atlas_runtime_slo_evaluations(evaluation_id,policy_id,pool_id,window_start,window_end,sample_count,good_count,bad_ratio,observed_value,error_budget_remaining,status)
 VALUES(p_evaluation_id,p_policy_id,p_pool_id,now()-make_interval(secs=>policy.window_seconds),now(),sample_count,good_count,bad_ratio,observed,budget,evaluation_status);
 alert_severity := CASE WHEN evaluation_status='critical' THEN 'critical' WHEN evaluation_status='warning' THEN 'warning' ELSE NULL END;
 IF alert_severity IS NOT NULL THEN
   INSERT INTO atlas_runtime_alerts(alert_id,fingerprint,policy_id,pool_id,severity,status,current_value,threshold)
   VALUES(alert_key,alert_key,p_policy_id,p_pool_id,alert_severity,'open',observed,CASE WHEN alert_severity='critical' THEN policy.critical_bad_ratio ELSE policy.warning_bad_ratio END)
   ON CONFLICT(fingerprint) DO UPDATE SET severity=EXCLUDED.severity,status='open',current_value=EXCLUDED.current_value,threshold=EXCLUDED.threshold,last_seen_at=now(),resolved_at=NULL;
 ELSE
   UPDATE atlas_runtime_alerts SET status='resolved',resolved_at=now(),last_seen_at=now() WHERE fingerprint=alert_key AND status <> 'resolved';
 END IF;
 IF evaluation_status='critical' THEN
   SELECT ri.incident_id INTO incident_uuid FROM atlas_runtime_incidents AS ri WHERE ri.fingerprint=incident_key;
   IF incident_uuid IS NULL THEN incident_uuid := md5(incident_key)::uuid; END IF;
   INSERT INTO atlas_runtime_incidents(incident_id,fingerprint,severity,status,title,last_seen_at,resolved_at)
   VALUES(incident_uuid,incident_key,'critical','open','Atlas runtime SLO breach: ' || p_policy_id,now(),NULL)
   ON CONFLICT(fingerprint) DO UPDATE SET severity='critical',status='open',last_seen_at=now(),resolved_at=NULL;
 ELSE
   UPDATE atlas_runtime_incidents SET status='resolved',resolved_at=now(),last_seen_at=now() WHERE fingerprint=incident_key AND status <> 'resolved';
 END IF;
 SELECT a.alert_id,i.incident_id INTO alert_key,incident_uuid FROM atlas_runtime_alerts a LEFT JOIN atlas_runtime_incidents i ON i.fingerprint=incident_key WHERE a.fingerprint=md5(p_policy_id || ':' || p_pool_id);
 RETURN QUERY SELECT evaluation_status,bad_ratio,observed,budget,alert_key,incident_uuid;
END;
$$;
COMMIT;
