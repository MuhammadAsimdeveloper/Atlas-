import { createHash } from 'node:crypto';

const IANA_TZ_CACHE = new Map();

export function assertIanaTimezone(timezone) {
  if (typeof timezone !== 'string' || timezone.length < 1 || timezone.length > 80) throw new TypeError('timezone_invalid');
  if (IANA_TZ_CACHE.has(timezone)) return timezone;
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); }
  catch { throw new TypeError('timezone_invalid'); }
  IANA_TZ_CACHE.set(timezone, true);
  return timezone;
}

function partsInZone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date);
  const out = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { year:+out.year, month:+out.month, day:+out.day, hour:+out.hour, minute:+out.minute, second:+out.second, weekday:{Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[out.weekday] };
}

function cronField(value, min, max) {
  const set = new Set();
  for (const raw of value.split(',')) {
    const [base, stepText] = raw.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new TypeError('cron_step_invalid');
    let start=min, end=max;
    if (base !== '*') {
      if (!/^\d+$/.test(base)) throw new TypeError('cron_field_invalid');
      start=Number(base); end=start;
    }
    if (start<min || end>max || start>end) throw new TypeError('cron_range_invalid');
    for (let n=start;n<=end;n+=step) set.add(n);
  }
  return set;
}

export function parseCron(expression) {
  if (typeof expression !== 'string') throw new TypeError('cron_invalid');
  const f=expression.trim().split(/\s+/);
  if (f.length!==5) throw new TypeError('cron_requires_five_fields');
  return {
    minute:cronField(f[0],0,59), hour:cronField(f[1],0,23), day:cronField(f[2],1,31),
    month:cronField(f[3],1,12), weekday:cronField(f[4],0,7)
  };
}

export function nextCronOccurrence({ expression, timezone='UTC', after=new Date(), dstPolicy='skip' }={}) {
  assertIanaTimezone(timezone); const cron=parseCron(expression);
  const start=new Date(after); start.setUTCSeconds(0,0); start.setUTCMinutes(start.getUTCMinutes()+1);
  for(let i=0;i<366*24*60;i++){
    const d=new Date(start.getTime()+i*60_000), p=partsInZone(d,timezone);
    const wd=p.weekday===7?0:p.weekday;
    const dayMatch=cron.day.has(p.day), weekMatch=cron.weekday.has(wd);
    if(cron.minute.has(p.minute)&&cron.hour.has(p.hour)&&cron.month.has(p.month)&&((cron.day.size===31&&cron.weekday.size===7)||(dayMatch||weekMatch))) return d.toISOString();
  }
  throw new Error('cron_next_occurrence_not_found');
}

export function nextIntervalOccurrence({ expression, after=new Date() }={}) {
  const seconds=Number(expression);
  if(!Number.isInteger(seconds)||seconds<60||seconds>31_536_000) throw new TypeError('interval_invalid');
  return new Date(new Date(after).getTime()+seconds*1000).toISOString();
}

export function nextCalendarOccurrence({ expression, timezone='UTC', after=new Date() }={}) {
  assertIanaTimezone(timezone);
  const date=new Date(expression);
  if(Number.isNaN(date.getTime()) || date<=new Date(after).getTime()) throw new TypeError('calendar_expression_invalid');
  return date.toISOString();
}

export function nextScheduleOccurrence(schedule, after=new Date()) {
  if(schedule.schedule_kind==='cron') return nextCronOccurrence({expression:schedule.expression,timezone:schedule.timezone,after,dstPolicy:schedule.dst_policy});
  if(schedule.schedule_kind==='interval') return nextIntervalOccurrence({expression:schedule.expression,after});
  if(schedule.schedule_kind==='calendar') return nextCalendarOccurrence({expression:schedule.expression,timezone:schedule.timezone,after});
  throw new TypeError('schedule_kind_invalid');
}

function pathGet(root,path) {
  return String(path).split('.').filter(Boolean).reduce((v,k)=>v == null ? undefined : v[k],root);
}

export function evaluatePredicate(value, predicate) {
  if (predicate == null) return true;
  if (typeof predicate !== 'object' || Array.isArray(predicate)) throw new TypeError('predicate_invalid');
  if (Array.isArray(predicate.all)) return predicate.all.every(p=>evaluatePredicate(value,p));
  if (Array.isArray(predicate.any)) return predicate.any.some(p=>evaluatePredicate(value,p));
  if (predicate.not !== undefined) return !evaluatePredicate(value,predicate.not);
  const actual=pathGet(value,predicate.path);
  if ('exists' in predicate) return Boolean(predicate.exists) === (actual !== undefined && actual !== null);
  if ('equals' in predicate) return actual === predicate.equals;
  if (Array.isArray(predicate.in)) return predicate.in.some(v=>v===actual);
  if ('prefix' in predicate) return typeof actual==='string' && actual.startsWith(String(predicate.prefix));
  if ('contains' in predicate) return Array.isArray(actual) ? actual.includes(predicate.contains) : typeof actual==='string' && actual.includes(String(predicate.contains));
  if ('gt' in predicate) return typeof actual==='number' && actual>predicate.gt;
  if ('gte' in predicate) return typeof actual==='number' && actual>=predicate.gte;
  if ('lt' in predicate) return typeof actual==='number' && actual<predicate.lt;
  if ('lte' in predicate) return typeof actual==='number' && actual<=predicate.lte;
  throw new TypeError('predicate_operator_invalid');
}

export function routeEvent({ routes=[], event }) {
  return [...routes].filter(r=>r.enabled!==false).filter(r=>evaluatePredicate(event,r.predicate||null))
    .sort((a,b)=>(Number(b.priority)||0)-(Number(a.priority)||0)||(String(a.route_id).localeCompare(String(b.route_id))));
}

export function eventDedupKey({ tenantId, eventType, eventRef, payloadHash }) {
  return createHash('sha256').update([tenantId,eventType,eventRef,payloadHash].join('|')).digest('hex');
}

export function actionAllowed({ riskClass='standard', requiresApproval=false, approved=false, capabilityVerified=false }) {
  if (!['read','standard','sensitive','financial','destructive'].includes(riskClass)) return false;
  if (!capabilityVerified) return false;
  if (riskClass==='financial'||riskClass==='destructive'||riskClass==='sensitive'||requiresApproval) return approved;
  return true;
}

export function createPromotionManifest({ workflowId, version, payload, connectorBindings=[], actionBindings=[] }) {
  const canonical=JSON.stringify({workflowId,version,payload,connectorBindings:[...connectorBindings].sort(),actionBindings:[...actionBindings].sort()});
  return { manifest: canonical, sha256:createHash('sha256').update(canonical).digest('hex') };
}

export function canPromote({ sourceStage, targetStage, approved=false, manifestSha256 }) {
  if (!['draft','staging','production'].includes(sourceStage)||!['draft','staging','production'].includes(targetStage)) return false;
  if (sourceStage==='production'||targetStage==='draft'||sourceStage===targetStage) return false;
  return approved===true && /^[a-f0-9]{64}$/.test(manifestSha256||'');
}

export function boundedJson(value,maxBytes=32_000) {
  const text=JSON.stringify(value??{});
  if(Buffer.byteLength(text)>maxBytes) throw new TypeError('json_too_large');
  return JSON.parse(text);
}
