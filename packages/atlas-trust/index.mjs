import crypto from 'node:crypto';

const canon = value => Array.isArray(value) ? value.map(canon) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canon(value[k])])) : value;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');
const freeze = value => Object.freeze(value);
const text = (value, field, max=500) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(field + ' invalid'); return value.trim(); };
const ref = (value, field) => text(value, field, 160);
const idempotency = key => /^[A-Za-z0-9._:-]{8,200}$/.test(key) ? key : (()=>{ throw new Error('Invalid idempotency key'); })();

export const US_COMPLIANCE_PROFILES = Object.freeze([
  'SOC2_SECURITY_CONTROLS','PCI_DSS_PAYMENT_BOUNDARY','CCPA_CPRA_PRIVACY',
  'TCPA_MESSAGING_CONSENT','CAN_SPAM_EMAIL','A2P_10DLC_MESSAGING',
  'HIPAA_OPTIONAL_BOUNDARY','GDPR_OPTIONAL_BOUNDARY','IRS_1099_CONTRACTOR_SUPPORT'
]);

export const CONNECTOR_CATEGORIES = Object.freeze([
  'crm','calendar','email','sms','voice','whatsapp','payments','accounting','ads',
  'social','storage','documents','support','analytics','seo','commerce','identity','ai','webhooks'
]);

export const CONNECTOR_OPERATIONS = Object.freeze([
  'read','create','update','delete','search','send','receive','sync','subscribe','unsubscribe','authorize','revoke'
]);

export function defineConnector({ id, provider, category, operations, auth='oauth2', scopes=[], webhookEvents=[], risk='medium', dataClasses=[] } = {}) {
  id = ref(id,'connectorId'); provider = ref(provider,'provider');
  if (!CONNECTOR_CATEGORIES.includes(category)) throw new Error('Unsupported connector category');
  if (!Array.isArray(operations) || operations.length < 1 || operations.some(x=>!CONNECTOR_OPERATIONS.includes(x))) throw new Error('Invalid connector operations');
  if (!Array.isArray(scopes) || scopes.length > 40) throw new Error('Connector scopes invalid');
  if (!['oauth2','api_key','signed_webhook','service_account','oidc'].includes(auth)) throw new Error('Unsupported connector auth');
  if (!['low','medium','high','critical'].includes(risk)) throw new Error('Connector risk invalid');
  const body = { id, provider, category, operations:[...new Set(operations)], auth, scopes:[...new Set(scopes)], webhookEvents:[...new Set(webhookEvents)].slice(0,100), risk, dataClasses:[...new Set(dataClasses)].slice(0,50) };
  return freeze({...body, checksum:hash(body)});
}

export function createConnectorGrant({ tenantId, connector, principalId, allowedOperations, allowedScopes=[], expiresAt, environment='production', ipRestrictions=[] } = {}) {
  tenantId=ref(tenantId,'tenantId'); principalId=ref(principalId,'principalId');
  if (!connector || connector.checksum !== hash({...connector, checksum:undefined})) throw new Error('Invalid connector definition');
  if (!Array.isArray(allowedOperations) || allowedOperations.some(x=>!connector.operations.includes(x))) throw new Error('Connector operation outside grant');
  if (!Array.isArray(allowedScopes) || allowedScopes.some(x=>!connector.scopes.includes(x))) throw new Error('Connector scope outside grant');
  const expiry=Date.parse(expiresAt); if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('Connector grant expired');
  const body={id:'grant_'+crypto.randomUUID().replaceAll('-',''),tenantId,connectorId:connector.id,principalId,allowedOperations:[...new Set(allowedOperations)],allowedScopes:[...new Set(allowedScopes)],expiresAt:new Date(expiry).toISOString(),environment,ipRestrictions:[...new Set(ipRestrictions)].slice(0,50)};
  return freeze({...body,checksum:hash(body)});
}

export function authorizeConnectorCall({ grant, connector, tenantId, operation, scope=null, now=Date.now(), requestId } = {}) {
  if (!grant || hash({...grant,checksum:undefined}) !== grant.checksum || grant.tenantId !== tenantId) throw new Error('Connector grant invalid');
  if (!connector || connector.id !== grant.connectorId) throw new Error('Connector mismatch');
  if (Date.parse(grant.expiresAt) <= now) return {allowed:false,code:'GRANT_EXPIRED'};
  if (!grant.allowedOperations.includes(operation)) return {allowed:false,code:'OPERATION_DENIED'};
  if (scope && !grant.allowedScopes.includes(scope)) return {allowed:false,code:'SCOPE_DENIED'};
  if (!requestId) return {allowed:false,code:'REQUEST_ID_REQUIRED'};
  return {allowed:true,code:'ALLOWED',requestId};
}

export function planConnectorSync({ tenantId, connectorId, direction='bidirectional', cursor=null, conflict='version_then_timestamp', maxBatch=100 } = {}) {
  if (!['inbound','outbound','bidirectional'].includes(direction)) throw new Error('Sync direction invalid');
  if (!['version_then_timestamp','source_priority','manual_review'].includes(conflict)) throw new Error('Conflict policy invalid');
  if (!Number.isSafeInteger(maxBatch) || maxBatch<1 || maxBatch>500) throw new Error('Batch out of bounds');
  const body={tenantId:ref(tenantId,'tenantId'),connectorId:ref(connectorId,'connectorId'),direction,conflict,cursor,maxBatch,createdAt:new Date().toISOString()};
  return freeze({...body,checksum:hash(body)});
}

export function createABAutomation({ tenantId, id, source, destination, trigger, mapping, filters=[], errorPolicy='dead_letter', maxRecords=1000 } = {}) {
  if (!source || !destination || source.connectorId === destination.connectorId && source.operation === destination.operation) throw new Error('A-to-B endpoints must be meaningful');
  if (!['stop','retry','dead_letter','manual_review'].includes(errorPolicy)) throw new Error('A-to-B error policy invalid');
  if (!Array.isArray(mapping) || mapping.length>200) throw new Error('A-to-B mapping invalid');
  const body={tenantId:ref(tenantId,'tenantId'),id:ref(id,'automationId'),source,destination,trigger:text(trigger,'trigger',160),mapping,filters:filters.slice(0,100),errorPolicy,maxRecords};
  return freeze({...body,checksum:hash(body)});
}

export function authorizeABExecution({ automation, tenantId, actorId, recordCount, idempotencyKey, approval=null } = {}) {
  if (!automation || hash({...automation,checksum:undefined})!==automation.checksum || automation.tenantId!==tenantId) throw new Error('A-to-B automation invalid');
  if (!Number.isSafeInteger(recordCount) || recordCount<0 || recordCount>automation.maxRecords) throw new Error('A-to-B record bound exceeded');
  idempotency(idempotencyKey); ref(actorId,'actorId');
  const risky = automation.destination?.operation === 'delete' || automation.destination?.operation === 'send';
  if (risky && approval?.status !== 'approved') return {allowed:false,code:'APPROVAL_REQUIRED',approvalKey:hash({tenantId,automationId:automation.id,actorId,recordCount,idempotencyKey})};
  return {allowed:true,code:'ALLOWED',executionKey:hash({automation:automation.checksum,tenantId,actorId,recordCount,idempotencyKey})};
}

export function createSpendPolicy({ tenantId, currency='USD', maxTransaction=5000, dailyLimit=25000, monthlyLimit=100000, autoRechargeLimit=0, requireApprovalAbove=1000, allowedCategories=[] } = {}) {
  if (currency!=='USD') throw new Error('V103 US target currently requires USD billing boundary');
  const nums=[maxTransaction,dailyLimit,monthlyLimit,autoRechargeLimit,requireApprovalAbove];
  if (nums.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0) || maxTransaction>dailyLimit || dailyLimit>monthlyLimit) throw new Error('Invalid spend policy');
  const body={tenantId:ref(tenantId,'tenantId'),currency,maxTransaction,dailyLimit,monthlyLimit,autoRechargeLimit,requireApprovalAbove,allowedCategories:[...new Set(allowedCategories)].slice(0,100)};
  return freeze({...body,checksum:hash(body)});
}

export function authorizeSpend({ policy, amount, category, dailySpent=0, monthlySpent=0, idempotencyKey, approval=null } = {}) {
  if (!policy || hash({...policy,checksum:undefined})!==policy.checksum) throw new Error('Spend policy invalid');
  if (typeof amount!=='number'||!Number.isFinite(amount)||amount<=0) throw new Error('Spend amount invalid');
  idempotency(idempotencyKey);
  if (policy.allowedCategories.length && !policy.allowedCategories.includes(category)) return {allowed:false,code:'CATEGORY_DENIED'};
  if (amount>policy.maxTransaction) return {allowed:false,code:'TRANSACTION_LIMIT'};
  if (dailySpent+amount>policy.dailyLimit) return {allowed:false,code:'DAILY_LIMIT'};
  if (monthlySpent+amount>policy.monthlyLimit) return {allowed:false,code:'MONTHLY_LIMIT'};
  if (amount>policy.requireApprovalAbove && approval?.status!=='approved') return {allowed:false,code:'APPROVAL_REQUIRED'};
  return {allowed:true,code:'ALLOWED',remainingDaily:policy.dailyLimit-dailySpent-amount,remainingMonthly:policy.monthlyLimit-monthlySpent-amount};
}

export function createLedgerTransaction({ tenantId, currency='USD', entries, idempotencyKey, sourceRef, metadata={} } = {}) {
  if (currency!=='USD') throw new Error('US target ledger currently requires USD');
  idempotency(idempotencyKey); ref(sourceRef,'sourceRef');
  if (!Array.isArray(entries) || entries.length<2 || entries.length>50) throw new Error('Ledger requires 2-50 entries');
  const debit=entries.filter(e=>e.direction==='debit').reduce((s,e)=>s+e.amount,0);
  const credit=entries.filter(e=>e.direction==='credit').reduce((s,e)=>s+e.amount,0);
  if (!Number.isFinite(debit)||!Number.isFinite(credit)||debit<=0||Math.round(debit*100)!==Math.round(credit*100)) throw new Error('Ledger transaction must balance');
  if (entries.some(e=>typeof e.amount!=='number'||e.amount<=0||!['debit','credit'].includes(e.direction))) throw new Error('Ledger entry invalid');
  const body={id:'txn_'+crypto.randomUUID().replaceAll('-',''),tenantId:ref(tenantId,'tenantId'),currency,entries,sourceRef,metadata,postedAt:new Date().toISOString()};
  return freeze({...body,checksum:hash(body)});
}

export function createRefund({ tenantId, originalTransactionId, amount, reason, idempotencyKey, requiresApprovalAbove=1000, approval=null } = {}) {
  if (amount<=0 || !Number.isFinite(amount)) throw new Error('Refund amount invalid');
  idempotency(idempotencyKey); ref(originalTransactionId,'originalTransactionId'); ref(reason,'reason',300);
  if (amount>requiresApprovalAbove && approval?.status!=='approved') return {status:'needs_approval',approvalKey:hash({tenantId,originalTransactionId,amount,idempotencyKey})};
  return {status:'approved',refundId:'refund_'+crypto.randomUUID().replaceAll('-',''),tenantId,originalTransactionId,amount,reason,idempotencyKey};
}

export function createFreelancerWorkspace({ tenantId, projectId, members, budget, currency='USD', approvalThreshold=500, paymentMode='invoice_milestone' } = {}) {
  if (currency!=='USD') throw new Error('US target freelancer workspace requires USD');
  if (!['invoice_milestone','hourly_timesheet','fixed_price'].includes(paymentMode)) throw new Error('Unsupported freelancer payment mode');
  if (!Array.isArray(members)||members.length<1||members.length>100) throw new Error('Freelancer members invalid');
  if (typeof budget!=='number'||budget<=0) throw new Error('Project budget invalid');
  const body={tenantId:ref(tenantId,'tenantId'),projectId:ref(projectId,'projectId'),members:members.map(m=>({id:ref(m.id,'memberId'),role:ref(m.role,'role'),permissions:[...new Set(m.permissions||[])]})),budget,currency,approvalThreshold,paymentMode};
  return freeze({...body,checksum:hash(body)});
}

export function authorizeFreelancerAction({ workspace, memberId, action, spend=0, approval=null } = {}) {
  const member=workspace.members.find(m=>m.id===memberId);
  if (!member) return {allowed:false,code:'MEMBER_NOT_FOUND'};
  if (!member.permissions.includes(action)) return {allowed:false,code:'PERMISSION_DENIED'};
  if (spend>workspace.approvalThreshold && approval?.status!=='approved') return {allowed:false,code:'APPROVAL_REQUIRED'};
  return {allowed:true,code:'ALLOWED'};
}

export function generateSeoMetadata({ title, description, canonicalUrl, siteName, imageUrl, locale='en_US', type='website', robots='index,follow', keywords=[] } = {}) {
  title=text(title,'title',120); description=text(description,'description',320);
  if (!/^https?:\\/\\//.test(canonicalUrl)) throw new Error('canonicalUrl invalid');
  if (imageUrl && !/^https?:\\/\\//.test(imageUrl)) throw new Error('imageUrl invalid');
  const body={title,description,canonicalUrl,siteName:text(siteName,'siteName',120),imageUrl:imageUrl||null,locale,type,robots,keywords:[...new Set(keywords)].slice(0,30)};
  return freeze({...body,checksum:hash(body)});
}

export function createSecurityControlPlane({ tenantId, mfaRequired=true, sessionMaxMinutes=480, requireStepUpForMoney=true, requireStepUpForSecrets=true, backupRetentionDays=35, immutableAuditDays=3650, breakGlassRequiresTwoApprovals=true } = {}) {
  if (sessionMaxMinutes<15||sessionMaxMinutes>1440) throw new Error('Session lifetime out of bounds');
  if (backupRetentionDays<7||backupRetentionDays>3650) throw new Error('Backup retention out of bounds');
  if (immutableAuditDays<365||immutableAuditDays>3650*3) throw new Error('Audit retention out of bounds');
  const body={tenantId:ref(tenantId,'tenantId'),mfaRequired,sessionMaxMinutes,requireStepUpForMoney,requireStepUpForSecrets,backupRetentionDays,immutableAuditDays,breakGlassRequiresTwoApprovals};
  return freeze({...body,checksum:hash(body)});
}

export function assessHighValueAction({ controlPlane, action, amount=0, hasRecentStepUp=false, approvals=0 } = {}) {
  if (!controlPlane || hash({...controlPlane,checksum:undefined})!==controlPlane.checksum) throw new Error('Security control plane invalid');
  const money=['charge','refund','payout','wallet_recharge','subscription_change'].includes(action);
  const secret=['reveal_secret','rotate_key','change_oauth_scope'].includes(action);
  if ((money&&controlPlane.requireStepUpForMoney || secret&&controlPlane.requireStepUpForSecrets) && !hasRecentStepUp) return {allowed:false,code:'STEP_UP_REQUIRED'};
  if (action==='break_glass' && (controlPlane.breakGlassRequiresTwoApprovals ? approvals<2 : approvals<1)) return {allowed:false,code:'DUAL_APPROVAL_REQUIRED'};
  return {allowed:true,code:'ALLOWED'};
}
