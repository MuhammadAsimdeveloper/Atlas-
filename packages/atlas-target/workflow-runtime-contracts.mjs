const ERROR_CODE=/^[a-z][a-z0-9_.-]{0,79}$/;
const CATEGORY_RULES=Object.freeze([
  [/^approval_|^permission_|^forbidden|^auth_/, 'policy', false, 'none'],
  [/^validation_|^invalid_|^schema_/, 'validation', false, 'none'],
  [/^(timeout|provider_timeout)$/, 'timeout', true, 'known'],
  [/^provider_retry_unsafe$/, 'provider', false, 'unknown'],
  [/^provider_/, 'provider', true, 'unknown'],
  [/^network_/, 'network', true, 'unknown'],
  [/^rate_limit/, 'rate_limit', true, 'unknown'],
  [/^quota_/, 'quota', false, 'none'],
  [/^credential_/, 'credential', false, 'none'],
  [/^canceled/, 'cancellation', false, 'none']
]);

export function normalizeWorkflowError({code,message='',source='workflow',externalOutcome=null,retryable=null}={}){
  if(typeof code!=='string'||!ERROR_CODE.test(code))throw new TypeError('Workflow error code is invalid');
  const boundedSource=typeof source==='string'&&/^[a-z][a-z0-9_.-]{0,39}$/.test(source)?source:'workflow';
  const rule=CATEGORY_RULES.find(([pattern])=>pattern.test(code));
  const category=rule?.[1]||'workflow';
  const defaultRetryable=rule?.[2] ?? false;
  const defaultOutcome=rule?.[3] ?? 'none';
  const outcome=externalOutcome===null?defaultOutcome:externalOutcome;
  if(!['none','known','unknown','reconciliation_required'].includes(outcome))throw new TypeError('Workflow external outcome is invalid');
  const canRetry=retryable===null?defaultRetryable:Boolean(retryable);
  if(outcome==='unknown' && canRetry===false) {
    return Object.freeze({code,category,retryable:false,externalOutcome:'unknown'});
  }
  if(outcome==='unknown' && canRetry===true) {
    return Object.freeze({code,category,retryable:true,externalOutcome:'unknown'});
  }
  return Object.freeze({code,category,retryable:canRetry,externalOutcome:outcome});
}

export function errorFingerprint({code,category,source='workflow',externalOutcome='none'}={}){
  if(typeof code!=='string'||!ERROR_CODE.test(code))throw new TypeError('Workflow error code is invalid');
  if(typeof category!=='string'||!/^[a-z][a-z0-9_.-]{0,39}$/.test(category))throw new TypeError('Workflow error category is invalid');
  const boundedSource=typeof source==='string'&&/^[a-z][a-z0-9_.-]{0,39}$/.test(source)?source:'workflow';
  return Object.freeze({code,category,source:boundedSource,externalOutcome});
}
