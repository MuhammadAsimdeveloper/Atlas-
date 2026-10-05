import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
export async function loadInboxContentStore(env=process.env){
 const name=env.ATLAS_INBOX_CONTENT_MODULE || (env.NODE_ENV==='production'?'':'example.mjs');
 if(!name||!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.mjs$/.test(name))throw Object.assign(new Error('Production inbox requires a reviewed content store module.'),{code:'inbox_content_store_unavailable'});
 const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../inbox-content');
 const target=path.resolve(base,name);if(!target.startsWith(base+path.sep))throw Object.assign(new Error('Inbox content module path is invalid.'),{code:'inbox_content_path_invalid'});
 const loaded=await import(pathToFileURL(target).href);
 if(typeof loaded.putMessageContent!=='function'||typeof loaded.getMessageContent!=='function')throw Object.assign(new Error('Inbox content module must export putMessageContent/getMessageContent.'),{code:'inbox_content_store_invalid'});
 return Object.freeze({putMessageContent:loaded.putMessageContent,getMessageContent:loaded.getMessageContent});
}
