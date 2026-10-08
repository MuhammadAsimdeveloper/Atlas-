import crypto from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^[a-f0-9]{64}$/i;
const REF=/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$/;
const SAFE_KEY=/^[a-z][a-z0-9_]{0,63}$/;
const SOURCE_TYPES=new Set(['help_article','faq','policy','manual','website','product_doc','release_note','public_doc','internal_runbook']);
const PRIVATE_KEY=/password|passcode|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|cookie|private[_-]?key/i;
const EMAIL=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE=/\+?\d[\d(). -]{6,}\d/g;
const SECRET_VALUE=/(?:token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*[^\s,;]+/gi;
const INJECTION_PATTERNS=[
  ['instruction_override',/ignore (?:all|any|the|previous|prior) instructions?|disregard (?:all|any|the|previous|prior) instructions?/i],
  ['system_prompt_extraction',/(?:reveal|show|print|leak).{0,40}(?:system prompt|developer message|hidden prompt)/i],
  ['policy_override',/(?:override|bypass|disable).{0,40}(?:policy|guardrail|safety|approval)/i],
  ['secret_exfiltration',/(?:reveal|show|print|send|export|dump|leak).{0,40}(?:api key|access token|refresh token|password|secret|credential)/i],
  ['data_exfiltration',/(?:send|export|upload|forward).{0,50}(?:customer|contact|private|internal).{0,30}(?:data|records|database)/i]
];

function text(value,label,max=240){
 if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\r\n\u0000]/.test(value)) throw new TypeError(label+' must be bounded text');
 return value.trim();
}
function ref(value,label){const v=text(value,label,240);if(!REF.test(v))throw new TypeError(label+' is invalid');return v;}
function uuid(value,label){if(typeof value!=='string'||!UUID.test(value))throw new TypeError(label+' must be a UUID');return value;}
function sha(value,label){if(typeof value!=='string'||!SHA256.test(value))throw new TypeError(label+' must be SHA-256');return value.toLowerCase();}
function int(value,label,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)throw new TypeError(label+' must be an integer from '+min+' to '+max);return value;}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;}
function digest(value){return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}

export function createKnowledgeStore({tenantId,id,name,version=1,status='draft',defaultSourceTypes=null}={}){
 uuid(tenantId,'tenantId'); uuid(id,'knowledgeStoreId'); text(name,'knowledge store name',160); int(version,'version',1,1_000_000);
 if(!['draft','published','archived'].includes(status))throw new TypeError('knowledge store status is invalid');
 const sourceTypes=defaultSourceTypes==null?[...SOURCE_TYPES]:[...new Set(defaultSourceTypes.map(v=>text(v,'sourceType',60)))];
 if(sourceTypes.some(v=>!SOURCE_TYPES.has(v)))throw new TypeError('knowledge store source type is not supported');
 const body={tenantId,id,name:name.trim(),version,status,defaultSourceTypes:sourceTypes.sort()};
 return freeze({...body,checksum:digest(body)});
}

export function verifyKnowledgeStore(store){
 if(!store||typeof store!=='object'||!SHA256.test(String(store.checksum||'')))return false;
 const {checksum,...body}=store;
 return digest(body)===String(checksum).toLowerCase();
}

export function createKnowledgeDocument({tenantId,storeId,documentId,sourceType,title,contentRef,contentHash,chunks=[],metadata={}}={}){
 uuid(tenantId,'tenantId'); uuid(storeId,'storeId'); uuid(documentId,'documentId');
 const safeSource=text(sourceType,'sourceType',60); if(!SOURCE_TYPES.has(safeSource))throw new TypeError('sourceType is not supported');
 text(title,'title',200); ref(contentRef,'contentRef'); sha(contentHash,'contentHash');
 if(!Array.isArray(chunks)||chunks.length<1||chunks.length>100)throw new TypeError('knowledge chunks must contain 1-100 items');
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw new TypeError('knowledge metadata must be an object');
 const safeChunks=chunks.map((chunk,index)=>{
   if(!chunk||typeof chunk!=='object'||Array.isArray(chunk))throw new TypeError('knowledge chunk '+index+' is invalid');
   const chunkRef=ref(chunk.chunkRef,'chunkRef');
   const value=text(chunk.text,'chunk text',8000);
   const hash=sha(chunk.contentHash,'chunk contentHash');
   const injection=detectPromptInjection(value);
   return {chunkRef,text:value,contentHash:hash,trust:'untrusted_knowledge',injectionCodes:injection.codes,injectionBlocked:injection.blocked};
 });
 const body={tenantId,storeId,documentId,sourceType:safeSource,title:text(title,'title',200),contentRef,contentHash,chunks:safeChunks,metadata:canonical(metadata)};
 return freeze({...body,rawContentStored:false,checksum:digest(body)});
}

export function verifyKnowledgeDocument(document){
 if(!document||typeof document!=='object'||!SHA256.test(String(document.checksum||'')))return false;
 const {checksum,...body}=document;
 return digest(body)===String(checksum).toLowerCase();
}

export function createRetrievalPolicy({tenantId,storeId,topK=8,minScore=0.55,reranker='none',allowedSourceTypes=null,requireCitations=true,maxExcerptChars=4000}={}){
 uuid(tenantId,'tenantId'); uuid(storeId,'storeId'); int(topK,'topK',1,20);
 const score=Number(minScore); if(!Number.isFinite(score)||score<0||score>1)throw new TypeError('minScore must be 0-1');
 if(!['none','weighted','cross_encoder'].includes(reranker))throw new TypeError('reranker is invalid');
 const sourceTypes=allowedSourceTypes==null?[...SOURCE_TYPES]:[...new Set(allowedSourceTypes.map(v=>text(v,'sourceType',60)))];
 if(sourceTypes.some(v=>!SOURCE_TYPES.has(v)))throw new TypeError('retrieval source type is not supported');
 if(typeof requireCitations!=='boolean')throw new TypeError('requireCitations must be boolean');
 int(maxExcerptChars,'maxExcerptChars',100,8000);
 return freeze({tenantId,storeId,topK,minScore:score,reranker,allowedSourceTypes:sourceTypes.sort(),requireCitations,maxExcerptChars});
}

function rankScore(hit,reranker){
 const base=Math.max(0,Math.min(1,Number(hit.score)||0));
 if(reranker==='none')return base;
 const rr=Math.max(0,Math.min(1,Number(hit.rerankScore ?? hit.score)||0));
 return reranker==='cross_encoder' ? (base*0.35+rr*0.65) : (base*0.7+rr*0.3);
}

export function retrieveKnowledge({tenantId,storeId,policy,query,candidates=[]}={}){
 uuid(tenantId,'tenantId'); uuid(storeId,'storeId'); text(query,'query',8000);
 if(!policy||policy.tenantId!==tenantId||policy.storeId!==storeId)throw new Error('retrieval policy tenant/store mismatch');
 if(!Array.isArray(candidates)||candidates.length>500)throw new TypeError('knowledge candidates must be 0-500');
 const seen=new Set();
 const hits=[];
 for(const candidate of candidates){
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))continue;
  if(candidate.tenantId!==tenantId||candidate.storeId!==storeId)continue;
  const candidateRef=ref(candidate.ref,'knowledge hit ref');
  if(seen.has(candidateRef))continue;
  seen.add(candidateRef);
  const sourceType=text(candidate.sourceType,'knowledge sourceType',60);
  if(!policy.allowedSourceTypes.includes(sourceType))continue;
  const score=Number(candidate.score);
  if(!Number.isFinite(score)||score<policy.minScore)continue;
  const excerpt=text(candidate.excerpt,'knowledge excerpt',policy.maxExcerptChars);
  const injection=detectPromptInjection(excerpt);
  const safe=redactKnowledgeText(excerpt);
  hits.push({tenantId,storeId,ref:candidateRef,sourceType,score,rerankScore:rankScore(candidate,policy.reranker),excerpt:safe,trust:'untrusted_knowledge',injectionCodes:injection.codes,injectionBlocked:injection.blocked});
 }
 hits.sort((a,b)=>b.rerankScore-a.rerankScore||b.score-a.score||a.ref.localeCompare(b.ref));
 return freeze(hits.slice(0,policy.topK));
}

export function enforceKnowledgeCitations({answerUsesKnowledge=false,citations=[],allowedRefs=[],requireCitations=true}={}){
 if(typeof answerUsesKnowledge!=='boolean'||typeof requireCitations!=='boolean')throw new TypeError('citation flags are invalid');
 if(!Array.isArray(citations)||citations.length>20)throw new TypeError('citations must contain 0-20 refs');
 const allowed=new Set(Array.isArray(allowedRefs)?allowedRefs.filter(v=>typeof v==='string'):[]);
 const safe=[...new Set(citations)];
 if(requireCitations&&answerUsesKnowledge&&safe.length===0)throw Object.assign(new Error('Knowledge-grounded answers require citations'),{code:'knowledge_citation_required'});
 if(safe.some(v=>!allowed.has(v)))throw Object.assign(new Error('Knowledge citation is outside the retrieved evidence set'),{code:'knowledge_citation_invalid'});
 return freeze({ok:true,citations:safe});
}

export function detectPromptInjection(value=''){
 const input=text(value,'knowledge text',12000);
 const codes=[...new Set(INJECTION_PATTERNS.filter(([,pattern])=>pattern.test(input)).map(([code])=>code))];
 return freeze({blocked:codes.length>0,codes});
}

export function redactKnowledgeText(value){
 if(typeof value!=='string')throw new TypeError('knowledge text must be text');
 let output=value.slice(0,12000);
 output=output.replace(EMAIL,'[redacted email]');
 output=output.replace(PHONE,'[redacted phone]');
 output=output.replace(SECRET_VALUE,'[redacted secret]');
 return output;
}

export function createEmbeddingRequest({tenantId,storeId,modelRef,text}={}){
 uuid(tenantId,'tenantId'); uuid(storeId,'storeId'); ref(modelRef,'modelRef');
 if(typeof text!=='string'||!text.trim()||text.length>12000||/[\u0000]/.test(text))throw new TypeError('embedding text is invalid');
 return freeze({tenantId,storeId,modelRef,textHash:digest(text),maxInputChars:12000,rawTextStored:false});
}

export async function runEmbeddingAdapter({request,text,adapter,signal}={}){
 if(!request||typeof request!=='object'||request.rawTextStored!==false)throw new TypeError('embedding request is invalid');
 uuid(request.tenantId,'tenantId'); uuid(request.storeId,'storeId'); ref(request.modelRef,'modelRef');
 if(typeof text!=='string'||!text.trim()||text.length>request.maxInputChars)throw new TypeError('embedding text is invalid');
 if(digest(text)!==request.textHash)throw new Error('embedding text hash mismatch');
 if(typeof adapter?.embed!=='function')throw new TypeError('embedding adapter is required');
 const output=await adapter.embed(Object.freeze({tenantId:request.tenantId,storeId:request.storeId,modelRef:request.modelRef,text,textHash:request.textHash,signal}));
 if(!output||typeof output!=='object'||Array.isArray(output)||!Array.isArray(output.vector))throw new Error('embedding adapter output is invalid');
 const dimensions=Number(output.dimensions??output.vector.length);
 if(!Number.isSafeInteger(dimensions)||dimensions<1||dimensions>4096||output.vector.length!==dimensions)throw new Error('embedding dimensions are invalid');
 if(output.vector.some(value=>typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e6))throw new Error('embedding vector contains invalid values');
 return freeze({dimensions,vector:Object.freeze([...output.vector]),rawTextStored:false,textHash:request.textHash});
}

export async function rerankKnowledge({tenantId,storeId,queryHash,hits=[],adapter}={}){
 uuid(tenantId,'tenantId'); uuid(storeId,'storeId'); sha(queryHash,'queryHash');
 if(!Array.isArray(hits)||hits.length>50)throw new TypeError('rerank hits must contain 0-50');
 const scoped=[]; const seen=new Set();
 for(const hit of hits){
   if(!hit||typeof hit!=='object'||Array.isArray(hit)||hit.tenantId!==tenantId||hit.storeId!==storeId)continue;
   const hitRef=ref(hit.ref,'knowledge hit ref');
   if(seen.has(hitRef))continue;
   seen.add(hitRef);
   scoped.push({...hit,ref:hitRef,trust:'untrusted_knowledge'});
 }
 if(!scoped.length)return freeze([]);
 if(typeof adapter?.rerank!=='function')return freeze(scoped);
 const output=await adapter.rerank(Object.freeze({tenantId,storeId,queryHash,refs:Object.freeze(scoped.map(hit=>hit.ref)),scores:Object.freeze(scoped.map(hit=>Number(hit.score)||0))}));
 if(!Array.isArray(output)||output.length>50)throw new Error('reranker output is invalid');
 const scores=new Map();
 for(const row of output){
   if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('reranker output row is invalid');
   const rowRef=ref(row.ref,'reranker ref');
   if(!scoped.some(hit=>hit.ref===rowRef))throw Object.assign(new Error('Reranker returned an unknown evidence ref'),{code:'reranker_ref_invalid'});
   const score=Number(row.score);
   if(!Number.isFinite(score)||score<0||score>1)throw new Error('reranker score is invalid');
   if(scores.has(rowRef))throw new Error('reranker returned duplicate evidence ref');
   scores.set(rowRef,score);
 }
 const ranked=scoped.map(hit=>({...hit,rerankScore:scores.has(hit.ref)?scores.get(hit.ref):Math.max(0,Math.min(1,Number(hit.score)||0))}));
 ranked.sort((a,b)=>b.rerankScore-a.rerankScore||Number(b.score||0)-Number(a.score||0)||a.ref.localeCompare(b.ref));
 return freeze(ranked);
}

export function createMemoryLifecyclePolicy({scope='conversation',retentionDays=30,requireConsent=true,maxFacts=20}={}){
 if(!['none','conversation','contact','tenant'].includes(scope))throw new TypeError('memory scope is invalid');
 int(retentionDays,'retentionDays',1,90); int(maxFacts,'maxFacts',1,50);
 if(typeof requireConsent!=='boolean')throw new TypeError('requireConsent must be boolean');
 return freeze({scope,retentionDays,requireConsent,maxFacts});
}

export function evaluateMemoryLifecycle({policy,tenantId,scopeRef,consent,facts=[],now=Date.now()}={}){
 uuid(tenantId,'tenantId'); ref(scopeRef,'scopeRef');
 if(!policy||policy.scope==='none')return freeze({status:'disabled',items:[],reason:'memory_disabled'});
 if(!Array.isArray(facts)||facts.length>policy.maxFacts)throw new TypeError('memory facts exceed policy limit');
 const nowMs=Number(now); if(!Number.isFinite(nowMs))throw new TypeError('now is invalid');
 if(policy.requireConsent){
   if(!consent||consent.tenantId!==tenantId||consent.scopeRef!==scopeRef||consent.status!=='granted')throw Object.assign(new Error('Valid memory consent is required'),{code:'memory_consent_required'});
   const checkedAt=Date.parse(consent.checkedAt),expiresAt=Date.parse(consent.expiresAt);
   if(!Number.isFinite(checkedAt)||!Number.isFinite(expiresAt)||checkedAt>nowMs+60000||expiresAt<=nowMs||expiresAt-checkedAt>24*60*60_000)throw Object.assign(new Error('Memory consent is stale or expired'),{code:'memory_consent_invalid'});
 }
 const retentionMs=policy.retentionDays*86400000;
 const items=facts.map((fact,index)=>{
   if(!fact||typeof fact!=='object'||Array.isArray(fact))throw new TypeError('memory fact '+index+' is invalid');
   const id=ref(fact.id,'memory fact id');
   const key=text(fact.key,'memory fact key',64);
   if(!SAFE_KEY.test(key))throw new TypeError('memory fact key is invalid');
   const value=text(fact.value,'memory fact value',600);
   if(PRIVATE_KEY.test(key)||PRIVATE_KEY.test(value))throw new TypeError('memory fact contains secret material');
   const createdAt=Date.parse(fact.createdAt);
   if(!Number.isFinite(createdAt)||createdAt>nowMs+60000||createdAt<nowMs-retentionMs)throw Object.assign(new Error('Memory fact is stale or outside retention'),{code:'memory_fact_expired'});
   return {id,key,value,createdAt:new Date(createdAt).toISOString(),trust:'untrusted_memory_data'};
 });
 return freeze({status:'usable',items,expiresAt:consent?.expiresAt||null});
}
