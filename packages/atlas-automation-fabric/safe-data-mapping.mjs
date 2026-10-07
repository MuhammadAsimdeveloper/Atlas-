import { compileExpression, evaluateExpression } from '../atlas-core/expression-engine.mjs';
const PATH=/^(?:input|trigger|steps|contact|lead|deal|appointment|conversation|workflow)(?:\.[A-Za-z][A-Za-z0-9_]{0,63})+$/;
const TARGET=/^(?:contact|lead|deal|appointment|conversation|workflow)(?:\.[A-Za-z][A-Za-z0-9_]{0,63})+$/;
const RESERVED=new Set(['tenantId','actorId','credential','secret','token','authorization','password','cookie']);
const TRANSFORMS=new Set(['identity','trim','lowercase','uppercase','string','number','boolean','join']);
const REF= /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;

function bounded(value,label,max=120){if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\u0000]/.test(value))throw new TypeError(label+' is invalid');return value.trim();}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function pathParts(value,label,pattern){const path=bounded(value,label);if(!pattern.test(path))throw new TypeError(label+' must use an allowlisted path');const parts=path.split('.');if(parts.some(part=>RESERVED.has(part)))throw new TypeError(label+' references a reserved field');return parts;}
function getPath(root,parts){let value=root?.[parts[0]];for(const part of parts.slice(1)){if(value==null)return undefined;if(typeof value!=='object')return undefined;value=value[part];}return value;}
function transformValue(value,transform,args=[]){
 switch(transform){
  case 'identity': return value;
  case 'trim': return typeof value==='string'?value.trim():value;
  case 'lowercase': return typeof value==='string'?value.toLowerCase():value;
  case 'uppercase': return typeof value==='string'?value.toUpperCase():value;
  case 'string': return value==null?'':String(value);
  case 'number': { const n=typeof value==='number'?value:Number(value);if(!Number.isFinite(n))throw new TypeError('Mapped number is not finite');return n; }
  case 'boolean': return value===true||value===false?value:['true','1','yes','on'].includes(String(value).toLowerCase());
  case 'join': { if(!Array.isArray(value)||value.length>100)throw new TypeError('Mapped join value must be a bounded array');const sep=typeof args[0]==='string'?args[0]:', ';if(sep.length>10)throw new TypeError('Join separator is too long');return value.map(item=>String(item)).join(sep); }
  default: throw new TypeError('Unsupported mapping transform');
 }
}

export function validateDataMapping({mapping,maxMappings=100}={}){
 if(!Array.isArray(mapping)||mapping.length<1||mapping.length>maxMappings)throw new TypeError('mapping must contain 1-'+maxMappings+' entries');
 const seen=new Set();
 return mapping.map((item,index)=>{
   if(!item||typeof item!=='object'||Array.isArray(item))throw new TypeError('mapping['+index+'] must be an object');
   const hasSource=typeof item.source==='string';
   const hasExpression=typeof item.expression==='string';
   if(hasSource===hasExpression)throw new TypeError('mapping['+index+'] requires exactly one source or expression');
   const source=hasSource?pathParts(item.source,'mapping source',PATH):null;
   const expression=hasExpression?bounded(item.expression,'mapping expression',4000):null;
   if(expression)compileExpression(expression);
   const target=pathParts(item.target,'mapping target',TARGET);
   const transform=bounded(item.transform||'identity','mapping transform',30);
   if(!TRANSFORMS.has(transform))throw new TypeError('mapping transform is unsupported');
   if(expression&&transform!=='identity')throw new TypeError('expression mappings may not add a second transform');
   if(!item.target || seen.has(item.target))throw new TypeError('mapping targets must be unique');
   seen.add(item.target);
   return freeze({source:source?source.join('.'):null,expression,target:target.join('.'),transform,args:Array.isArray(item.args)?item.args.slice(0,5):[]});
 });
}

export function applyDataMapping({mapping,context,strict=true}={}){
 const normalized=validateDataMapping({mapping});
 if(!context||typeof context!=='object'||Array.isArray(context))throw new TypeError('mapping context is required');
 const output={};
 for(const item of normalized){
   const value=item.expression?evaluateExpression({expression:item.expression,context}):getPath(context,item.source.split('.'));
   if(value===undefined&&strict)throw new Error('Mapping source is unavailable: '+(item.source||item.expression));
   const transformed=item.expression?value:transformValue(value,item.transform,item.args);
   const parts=item.target.split('.');
   let cursor=output;
   for(let i=0;i<parts.length;i++){const key=parts[i];if(i===parts.length-1){cursor[key]=transformed;}else{cursor[key]??={};if(typeof cursor[key]!=='object'||Array.isArray(cursor[key]))throw new Error('Mapping target path conflicts with scalar data');cursor=cursor[key];}}
 }
 return freeze(output);
}
