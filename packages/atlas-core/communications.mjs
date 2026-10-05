import {assertChannel} from './capability-fabric.mjs';
const ID=/^[0-9a-f-]{8,120}$/i;
export function normalizeConversationKey({channel,externalThreadRef}){assertChannel(channel);if(typeof externalThreadRef!=='string'||externalThreadRef.length<1||externalThreadRef.length>240)throw new TypeError('External thread reference is required.');return channel+':'+externalThreadRef.trim();}
export function createConversationDraft({tenantId,channel,externalThreadRef,contactId=null,subject=null}){assertChannel(channel);if(typeof tenantId!=='string'||!tenantId)throw new TypeError('Tenant is required.');return {tenantId,channel,externalThreadRef:externalThreadRef.trim(),contactId,subject:subject?.slice(0,240)||null,status:'open',assignedAgentId:null,version:1};}
export function appendMessage(conversation,message){
 if(!conversation||conversation.status==='closed')throw Object.assign(new Error('Conversation is closed.'),{code:'conversation_closed'});
 if(!message||!['inbound','outbound','system'].includes(message.direction))throw Object.assign(new Error('Message direction is invalid.'),{code:'message_invalid'});
 return Object.freeze({...conversation,lastMessageAt:message.createdAt||new Date().toISOString(),version:conversation.version+1});
}
export function handoffConversation(conversation,{agentId,reason,expectedVersion}){if(!conversation||!ID.test(agentId||''))throw new TypeError('Agent ID is required.');if(conversation.version!==expectedVersion)throw Object.assign(new Error('Conversation changed.'),{code:'version_conflict'});if(typeof reason!=='string'||reason.length<3||reason.length>240)throw new TypeError('Handoff reason is invalid.');return Object.freeze({...conversation,assignedAgentId:agentId,handoffReason:reason,status:'open',version:conversation.version+1});}
