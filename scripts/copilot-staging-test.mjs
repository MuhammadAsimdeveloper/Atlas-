import assert from 'node:assert/strict';
const base=String(process.env.ATLAS_STAGING_ORIGIN||'').replace(/\/$/,'');
const widgetKey=String(process.env.ATLAS_STAGING_WIDGET_KEY||'');
const origin=String(process.env.ATLAS_STAGING_WIDGET_ORIGIN||base);\nconst cookie=String(process.env.ATLAS_STAGING_COOKIE||'');
const csrf=String(process.env.ATLAS_STAGING_CSRF||'');
if(!base||!widgetKey) throw new Error('ATLAS_STAGING_ORIGIN and ATLAS_STAGING_WIDGET_KEY are required');
async function req(path,options={}){const r=await fetch(base+path,options);const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{}return {r,text,body}}
const live=await req('/health/live');assert.equal(live.r.status,200);assert.equal(live.body.status,'ok');
const hub=await req('/copilot.html');assert.equal(hub.r.status,200);assert.match(hub.text,/Copilot Chat Hub/);
const widget=await req('/copilot-widget.mjs');assert.equal(widget.r.status,200);assert.match(widget.text,/session/);
const session=await req('/api/v1/public/copilot/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({widgetKey,customerRef:null})});
assert.equal(session.r.status,201,session.text);const token=session.body.sessionToken;assert.ok(token);
const turn=await req('/api/v1/public/copilot/turn',{method:'POST',headers:{origin,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({message:'staging smoke test acknowledgement',clientTurnId:crypto.randomUUID()})});
assert.equal(turn.r.status,202,turn.text);
const crossOrigin=await req('/api/v1/public/copilot/history',{headers:{origin:'https://atlas-invalid-origin.example',authorization:'Bearer '+token}});assert.equal(crossOrigin.r.status,403,crossOrigin.text);
const stream=await req('/api/v1/public/copilot/stream?executionId='+encodeURIComponent(turn.body.executionId),{headers:{origin,authorization:'Bearer '+token}});
assert.equal(stream.r.status,200,stream.text);assert.ok(stream.text.includes('event: '));assert.ok(stream.text.includes('data: '));
const history=await req('/api/v1/public/copilot/history',{headers:{origin,authorization:'Bearer '+token}});assert.equal(history.r.status,200,history.text);assert.ok(Array.isArray(history.body.items));
const handoff=await req('/api/v1/public/copilot/handoff',{method:'POST',headers:{origin,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({reason:'caller_requested_human'})});assert.equal(handoff.r.status,201,handoff.text);
if(cookie){assert.ok(csrf,'ATLAS_STAGING_CSRF is required with ATLAS_STAGING_COOKIE');const config=await req('/api/v1/platform/copilot/config',{headers:{cookie,origin:base}});assert.equal(config.r.status,200,config.text);assert.ok(config.body&&Object.hasOwn(config.body,'item'));
const q=await req('/api/v1/platform/copilot/handoffs',{headers:{cookie,origin:base}});assert.equal(q.r.status,200,q.text);const a=await req('/api/v1/platform/copilot/approvals',{headers:{cookie,origin:base}});assert.equal(a.r.status,200,a.text);}
else console.warn('COPILOT_STAGING_AUTH_SKIPPED: set ATLAS_STAGING_COOKIE and ATLAS_STAGING_CSRF to verify the authenticated Chat Hub APIs.');\nconsole.log('COPILOT_STAGING_E2E_OK');