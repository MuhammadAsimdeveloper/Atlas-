import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
export async function loadWebhookSecretResolver(env=process.env){
 const name=env.ATLAS_WEBHOOK_SECRET_RESOLVER_MODULE;
 if(!name||!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.mjs$/.test(name))throw Object.assign(new Error('Production webhook ingress requires a reviewed secret resolver module.'),{code:'webhook_secret_resolver_unavailable'});
 const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../webhook-secrets');
 const target=path.resolve(base,name);if(!target.startsWith(base+path.sep))throw Object.assign(new Error('Webhook secret module path is invalid.'),{code:'webhook_secret_path_invalid'});
 const loaded=await import(pathToFileURL(target).href);if(typeof loaded.resolveSecret!=='function')throw Object.assign(new Error('Webhook secret resolver must export resolveSecret.'),{code:'webhook_secret_resolver_invalid'});return loaded.resolveSecret;
}
