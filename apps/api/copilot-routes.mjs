import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createAuthError, hashOpaqueToken, isAllowedOrigin, parseCookies, sessionCookieName, verifyCsrf } from './auth-contracts.mjs';
import { securityHeaders, clientIdentity, enforceRateLimit } from './security.mjs';
import { createAgentReleaseManifest, verifyAgentDeploymentRelease } from '../../packages/atlas-agent-fabric/index.mjs';
import { createSupportSessionClaims, issueSupportSessionToken, verifySupportSessionToken, validateSupportTurnInput } from '../../packages/atlas-copilot/support-session.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const REF=/^[A-Za-z0-9_.:/@+-]{1,240}$/;

function send(res,status,body,env,extra={}) {
  res.writeHead(status,{...securityHeaders(env),...extra,'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(body)); return true;
}
async function readJson(req,max=100000) {
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>max)throw createAuthError(413,'request_too_large');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||Array.isArray(value)||typeof value!=='object')throw new Error();return value;}
  catch{throw createAuthError(400,'invalid_json');}
}
function hashText(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function exact(body,fields){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k)))throw createAuthError(400,'unsupported_request_fields');}
function bearer(req){const value=String(req.headers.authorization||'');if(!value.startsWith('Bearer '))throw createAuthError(401,'support_session_required');return value.slice(7).trim();}
function origin(req){const value=typeof req.headers.origin==='string'?req.headers.origin.trim():'';return value||null;}
function allowOrigin(req,allowed,env,{publicRequest=false}={}) {
  const o=origin(req);
  if(!Array.isArray(allowed)||allowed.length<1) throw createAuthError(503,'copilot_origins_unconfigured');
  if(!o){if(env.NODE_ENV==='production'&&publicRequest)throw createAuthError(403,'origin_required');return null;}
  if(!allowed.includes(o))throw createAuthError(403,'origin_forbidden');
  return o;
}
function corsHeaders(o){return o?{'access-control-allow-origin':o,'access-control-allow-credentials':'false','vary':'Origin'}:{ };}
function dbErrorStatus(error) {
  const code=String(error?.message||'');
  if(code==='copilot_origin_forbidden')return 403;
  if(code==='copilot_widget_not_found'||code==='copilot_session_not_found'||code==='copilot_execution_not_found')return 404;
  if(code==='copilot_release_runtime_incomplete')return 503;
  if(code==='copilot_release_inactive')return 409;
  if(code==='copilot_session_invalid'||code==='copilot_turn_invalid'||code==='copilot_handoff_invalid')return 400;
  return null;
}

export class PostgresCopilotStore {
  constructor(pool){this.pool=pool;}
  async #tenant({actorId,tenantId},work){
    if(!UUID.test(actorId||'')||!UUID.test(tenantId||''))throw createAuthError(409,'workspace_required');
    const c=await this.pool.connect();
    try{
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.actor_id',$1,true)",[actorId]);
      const m=await c.query("SELECT m.role_key,m.custom_role_id FROM atlas_organization_memberships m JOIN atlas_organizations o ON o.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND o.status='active'",[tenantId,actorId]);
      if(!m.rowCount)throw createAuthError(404,'organization_not_found');
      await c.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      const role=m.rows[0];
      if(!['owner','admin'].includes(role.role_key)){
        const grants=role.custom_role_id?await c.query('SELECT permissions FROM atlas_organization_roles WHERE tenant_id=$1 AND role_id=$2',[tenantId,role.custom_role_id]):{rows:[]};
        if(!grants.rows[0]?.permissions?.includes('inbox.read'))throw createAuthError(403,'copilot_forbidden');
      }
      const out=await work(c,m.rows[0]);await c.query('COMMIT');return out;
    }catch(e){try{await c.query('ROLLBACK');}catch{}throw e;}finally{c.release();}
  }
  async getConfig(who){return this.#tenant(who,async c=>{const {rows}=await c.query("SELECT config_id,widget_key,display_name,release_snapshot,allowed_origins,status,version,created_at,updated_at FROM atlas_v153_copilot_configs WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 1",[who.tenantId]);return rows[0]||null;});}
  async saveConfig(who,input){
    return this.#tenant({...who},async c=>{
      const snapshot=createAgentReleaseManifest(input.releaseSnapshot);
      if(!['active','canary'].includes(snapshot.status))throw createAuthError(400,'copilot_release_not_live');
      if(!UUID.test(snapshot.agentId))throw createAuthError(400,'copilot_agent_id_invalid');
      if(!snapshot.modelPolicy?.provider||!snapshot.modelPolicy?.credentialRef||!snapshot.modelPolicy?.model)throw createAuthError(400,'copilot_model_policy_incomplete');
      const origins=[...new Set((input.allowedOrigins||[]).map(x=>String(x).trim()))];
      if(!origins.length||origins.length>32||origins.some(x=>{try{const u=new URL(x);return u.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&u.protocol==='http:');}catch{return true;}}))throw createAuthError(400,'copilot_origins_invalid');
      const id=UUID.test(input.configId||'')?input.configId:randomUUID();
      const key=typeof input.widgetKey==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(input.widgetKey)?input.widgetKey:randomBytes(24).toString('base64url');
      const name=typeof input.displayName==='string'&&input.displayName.trim()?input.displayName.trim().slice(0,120):'Atlas Copilot';
      const {rows}=await c.query("INSERT INTO atlas_v153_copilot_configs(tenant_id,config_id,widget_key,display_name,release_snapshot,allowed_origins,status,version,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,'active',1,$7) ON CONFLICT(tenant_id,config_id) DO UPDATE SET widget_key=EXCLUDED.widget_key,display_name=EXCLUDED.display_name,release_snapshot=EXCLUDED.release_snapshot,allowed_origins=EXCLUDED.allowed_origins,status='active',version=atlas_v153_copilot_configs.version+1,updated_at=now() RETURNING config_id,widget_key,display_name,release_snapshot,allowed_origins,status,version,created_at,updated_at",[who.tenantId,id,key,name,JSON.stringify(snapshot),JSON.stringify(origins),who.actorId]);
      return rows[0];
    });
  }
  async listHandoffs(who){return this.#tenant({...who},c=>c.query("SELECT h.handoff_id,h.session_id,h.reason,h.queue_ref,h.status,h.requested_at,c.conversation_id,c.status AS conversation_status,c.handoff_reason,c.version FROM atlas_agent_handoffs h LEFT JOIN atlas_v122_conversations c ON c.tenant_id=h.tenant_id AND c.external_thread_ref='copilot:'||h.session_id::text WHERE h.tenant_id=$1 ORDER BY h.requested_at DESC LIMIT 200",[who.tenantId]).then(r=>r.rows));}
  async decideHandoff(who,id,input){
    if(!UUID.test(id)||!['accepted','resolved','canceled'].includes(input.status))throw createAuthError(400,'handoff_decision_invalid');
    return this.#tenant({...who},async c=>{
      const {rows}=await c.query("UPDATE atlas_agent_handoffs SET status=$3 WHERE tenant_id=$1 AND handoff_id=$2 AND status='pending' RETURNING handoff_id,session_id,status",[who.tenantId,id,input.status]);
      if(!rows.length)throw createAuthError(404,'handoff_not_found');
      await c.query("UPDATE atlas_ai_agent_sessions SET status=CASE WHEN $3='resolved' THEN 'completed' WHEN $3='canceled' THEN 'canceled' ELSE 'handoff' END,updated_at=now() WHERE tenant_id=$1 AND session_id=$2",[who.tenantId,rows[0].session_id]);
      return rows[0];
    });
  }
  async listApprovals(who){return this.#tenant({...who},c=>c.query("SELECT approval_id,session_id,action_key,status,requested_at,decided_at,decided_by FROM atlas_agent_tool_approvals WHERE tenant_id=$1 AND status='pending' ORDER BY requested_at DESC LIMIT 200",[who.tenantId]).then(r=>r.rows));}
}

export function createCopilotApi({pool,authStore,runtimeStore,inboxContentStore,env=process.env}={}) {
  if(!pool||!authStore||!runtimeStore||!inboxContentStore)throw new TypeError('Copilot API dependencies are incomplete');
  const store=new PostgresCopilotStore(pool);
  const secret=env.ATLAS_SUPPORT_SESSION_SECRET||env.ATLAS_SESSION_SECRET;
  if(!secret||Buffer.byteLength(secret)<32)throw new Error('ATLAS_SUPPORT_SESSION_SECRET or ATLAS_SESSION_SECRET must be at least 32 bytes');

  async function identity(req){
    const raw=parseCookies(req.headers.cookie).get(sessionCookieName(env));if(!raw)throw createAuthError(401,'authentication_required');
    const s=await authStore.getSession({sessionHash:hashOpaqueToken(raw)});if(!s?.tenantId)throw createAuthError(409,'workspace_required');
    return {actorId:s.user.id,tenantId:s.tenantId,session:s};
  }
  async function mutation(req,s){if(!isAllowedOrigin(req,env)||!(await verifyCsrf(req,s,env)))throw createAuthError(403,'csrf_check_failed');}

  async function publicClaims(req){
    const claims=verifySupportSessionToken({token:bearer(req),secret});
    if(claims.channel!=='webchat')throw createAuthError(403,'support_channel_forbidden');
    return claims;
  }
  async function publicSession(req,res){
    const b=await readJson(req);exact(b,['widgetKey','customerRef']);
    await enforceRateLimit({req,store:authStore,secret,env,route:'copilot.session',limit:30,windowSeconds:60});
    if(typeof b.widgetKey!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(b.widgetKey))throw createAuthError(400,'widget_key_invalid');
    const sessionId=randomUUID(),expiresAt=new Date(Date.now()+60*60_000);
    const requestedOrigin=origin(req);
    const result=(await pool.query('SELECT * FROM atlas_v153_create_public_session($1,$2,$3,$4,$5)',[b.widgetKey,sessionId,b.customerRef==null?null:String(b.customerRef),expiresAt,requestedOrigin])).rows[0];
    if(!result)throw createAuthError(404,'copilot_widget_not_found');
    const allowed=allowOrigin(req,result.allowed_origins,env,{publicRequest:true});
    const claims=createSupportSessionClaims({tenantId:result.tenant_id,agentReleaseRef:result.release_snapshot.releaseId,channel:'webchat',customerRef:b.customerRef==null?null:String(b.customerRef),sessionId,issuedAt:Date.now(),ttlMs:60*60_000});
    return send(res,201,{sessionToken:issueSupportSessionToken({claims,secret}),sessionId,expiresAt:expiresAt.toISOString(),release:{id:result.release_snapshot.releaseId,version:result.release_snapshot.version},widget:{configId:result.config_id,displayName:'Atlas Copilot'}},env,corsHeaders(allowed));
  }

  async function publicTurn(req,res,claims){
    const o=origin(req);
    const b=await readJson(req);exact(b,['message','clientTurnId']);
    if(typeof b.message!=='string')throw createAuthError(400,'message_invalid');
    if(typeof b.clientTurnId!=='string'||!/^[-A-Za-z0-9_.:]{8,160}$/.test(b.clientTurnId))throw createAuthError(400,'client_turn_id_invalid');
    const messageHash=hashText(b.message);
    const turn=validateSupportTurnInput({claims,sessionId:claims.sessionId,message:b.message,messageHash});
    const messageId=randomUUID(),contentRef='copilot-input:'+messageId;
    await inboxContentStore.putMessageContent({tenantId:turn.tenantId,messageId,channel:'webchat',text:b.message,html:null,attachments:[],metadata:{source:'copilot_public'}});
    const planId=randomUUID(),executionId=randomUUID(),idempotencyKey=createHash('sha256').update(JSON.stringify({tenantId:turn.tenantId,sessionId:turn.sessionId,clientTurnId:b.clientTurnId,messageHash})).digest('hex');
    const prepared=(await pool.query('SELECT * FROM atlas_v153_prepare_public_turn($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9)',[turn.tenantId,turn.sessionId,messageId,contentRef,messageHash,'turn_'+executionId.replaceAll('-',''),planId,executionId,idempotencyKey])).rows[0];
    if(!prepared)throw createAuthError(409,'copilot_turn_not_prepared');
    return send(res,202,{conversationId:prepared.conversation_id,executionId:prepared.execution_id,planId:prepared.plan_id,jobId:prepared.job_id,status:'queued',streamUrl:'/api/v1/public/copilot/stream?executionId='+prepared.execution_id},env,corsHeaders(o));
  }

  async function publicStream(req,res,claims,url){
    const o=origin(req);
    const executionId=url.searchParams.get('executionId');
    if(!UUID.test(executionId||''))throw createAuthError(400,'execution_id_invalid');
    const state=(await pool.query('SELECT * FROM atlas_v153_public_state($1,$2,$3)',[claims.tenantId,claims.sessionId,executionId])).rows;
    if(!state.length)throw createAuthError(404,'copilot_execution_not_found');
    const conversationId=state[0].conversation_id;
    const headers={...securityHeaders(env),...corsHeaders(o),'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-store','connection':'keep-alive','x-accel-buffering':'no'};
    req.setTimeout?.(0); res.socket?.setTimeout?.(0); res.writeHead(200,headers);
    let cursor=0, idle=0;
    const sendEvent=(type,data)=>{res.write('event: '+type+'\ndata: '+JSON.stringify(data)+'\n\n');};
    while(idle<480 && !res.destroyed){
      const events=(await pool.query("SELECT * FROM atlas_v153_public_stream($1,$2,$3,$4)",[claims.tenantId,claims.sessionId,executionId,cursor])).rows;
      for(const e of events){
        cursor=Number(e.sequence);
        let data={sequence:cursor};
        if(e.content_ref){const content=await inboxContentStore.getMessageContent({tenantId:claims.tenantId,messageId:executionId,contentRef:e.content_ref});data.delta=content?.text||'';}
        sendEvent(e.event_type,data);
      }
      const latest=(await pool.query('SELECT * FROM atlas_v153_public_execution($1,$2,$3)',[claims.tenantId,claims.sessionId,executionId])).rows[0]||null;
      if(latest?.status==='completed'||latest?.status==='handoff'||latest?.status==='waiting_approval'||latest?.status==='failed'||latest?.status==='canceled'){
        if(latest.status==='completed'){
          const final=(await pool.query("SELECT message_id,content_ref FROM atlas_v122_messages WHERE tenant_id=$1 AND conversation_id=$2 AND direction='outbound' ORDER BY created_at DESC LIMIT 1",[claims.tenantId,conversationId])).rows[0];
          if(final?.content_ref){const content=await inboxContentStore.getMessageContent({tenantId:claims.tenantId,messageId:final.message_id||executionId,contentRef:final.content_ref});sendEvent('done',{sequence:cursor,content:content?.text||''});}
        } else sendEvent(latest.status,{sequence:cursor,reason:latest.error_code||null});
        break;
      }
      await new Promise(r=>setTimeout(r,500));idle++;
      if(idle%10===0)sendEvent('heartbeat',{at:Date.now()});
    }
    res.end();
  }

  async function publicHistory(req,res,claims){
    const o=origin(req);
    const state=(await pool.query('SELECT * FROM atlas_v153_public_state($1,$2,NULL)',[claims.tenantId,claims.sessionId])).rows;
    const items=[]; const seen=new Set();
    for(const row of state){
      if(seen.has(row.message_id)) continue; seen.add(row.message_id);
      if(!row.message_id)continue;
      const content=await inboxContentStore.getMessageContent({tenantId:claims.tenantId,messageId:row.message_id,contentRef:row.content_ref});
      items.push({messageId:row.message_id,direction:row.message_direction,createdAt:row.created_at,text:content?.text||'',executionId:row.execution_id||null,status:row.execution_status||null});
    }
    return send(res,200,{items},env,corsHeaders(o));
  }

  async function publicHandoff(req,res,claims){
    const o=origin(req);const b=await readJson(req);exact(b,['reason']);
    const handoff=(await pool.query('SELECT * FROM atlas_v153_request_handoff($1,$2,$3,$4,$5)',[claims.tenantId,claims.sessionId,b.reason,randomUUID(),'copilot:webchat'])).rows[0];
    return send(res,201,{handoff},env,corsHeaders(o));
  }

  async function handle(req,res){
    const url=new URL(req.url||'/','http://localhost');
    try{
      if(url.pathname==='/api/v1/public/copilot/session' && req.method==='OPTIONS')return send(res,204,null,env,{'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type','access-control-max-age':'600'});
      if(url.pathname.startsWith('/api/v1/public/copilot/')){
        if(req.method==='OPTIONS')return send(res,204,null,env,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'authorization,content-type','access-control-max-age':'600'});
        if(url.pathname==='/api/v1/public/copilot/session'&&req.method==='POST')return await publicSession(req,res);
        const claims=await publicClaims(req);
        if(url.pathname==='/api/v1/public/copilot/turn'&&req.method==='POST')return await publicTurn(req,res,claims);
        if(url.pathname==='/api/v1/public/copilot/history'&&req.method==='GET')return await publicHistory(req,res,claims);
        if(url.pathname==='/api/v1/public/copilot/stream'&&req.method==='GET')return await publicStream(req,res,claims,url);
        if(url.pathname==='/api/v1/public/copilot/handoff'&&req.method==='POST')return await publicHandoff(req,res,claims);
        return send(res,404,{error:'not_found'},env);
      }
      if(!url.pathname.startsWith('/api/v1/platform/copilot'))return false;
      const who=await identity(req);
      if(url.pathname==='/api/v1/platform/copilot/config'&&req.method==='GET')return send(res,200,{item:await store.getConfig(who)},env);
      if(url.pathname==='/api/v1/platform/copilot/config'&&req.method==='PUT'){await mutation(req,who.session);const b=await readJson(req);exact(b,['configId','displayName','releaseSnapshot','allowedOrigins','widgetKey']);return send(res,200,{item:await store.saveConfig(who,b)},env);}
      if(url.pathname==='/api/v1/platform/copilot/handoffs'&&req.method==='GET')return send(res,200,{items:await store.listHandoffs(who)},env);
      const hand=url.pathname.match(/^\/api\/v1\/platform\/copilot\/handoffs\/([0-9a-f-]{36})$/i);
      if(hand&&req.method==='POST'){await mutation(req,who.session);const b=await readJson(req);exact(b,['status']);return send(res,200,{item:await store.decideHandoff(who,hand[1],b)},env);}
      if(url.pathname==='/api/v1/platform/copilot/approvals'&&req.method==='GET')return send(res,200,{items:await store.listApprovals(who)},env);
      const approval=url.pathname.match(/^\/api\/v1\/platform\/copilot\/approvals\/([0-9a-f-]{36})$/i);
      if(approval&&req.method==='POST'){await mutation(req,who.session);const b=await readJson(req);exact(b,['status']);if(!['approved','denied'].includes(b.status))throw createAuthError(400,'approval_status_invalid');return send(res,200,{item:await runtimeStore.decideAgentToolApproval({...who,approvalId:approval[1],status:b.status})},env);}
      return send(res,404,{error:'not_found'},env);
    }catch(error){
      const status=Number.isInteger(error?.status)?error.status:(dbErrorStatus(error)||500);
      if(status>=500)process.stderr.write('Copilot route failed: '+error.message+'\n');
      return send(res,status,status>=500?{error:'copilot_service_unavailable'}:{error:dbErrorStatus(error)?error.message:(error.code||'request_failed'),message:dbErrorStatus(error)?undefined:error.message},env);
    }
  }
  return {handle,store};
}
