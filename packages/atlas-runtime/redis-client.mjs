import net from 'node:net';
import tls from 'node:tls';

const URL_PROTOCOLS=new Set(['redis:','rediss:']);
const MAX_REPLY_BYTES=256*1024;

function encodeCommand(args){
  if(!Array.isArray(args)||!args.length) throw new TypeError('Redis command requires arguments.');
  const parts=[];
  for(const arg of args){const b=Buffer.from(String(arg),'utf8');parts.push(Buffer.from('$'+b.length+'\r\n'),b,Buffer.from('\r\n'));}
  return Buffer.concat([Buffer.from('*'+args.length+'\r\n'),...parts]);
}
function parseReply(buffer){
  if(!buffer.length)return null;
  const type=String.fromCharCode(buffer[0]), lineEnd=buffer.indexOf('\r\n',1);
  if(lineEnd<0)return null;
  const line=buffer.subarray(1,lineEnd).toString();
  if(type==='+'||type==='-'||type===':')return{value:type===':'?Number(line):line,bytes:lineEnd+2,error:type==='-'?new Error(line):null};
  if(type==='$'){const n=Number(line);if(n===-1)return{value:null,bytes:lineEnd+2};const end=lineEnd+2+n+2;if(buffer.length<end)return null;return{value:buffer.subarray(lineEnd+2,lineEnd+2+n).toString(),bytes:end};}
  if(type==='*'){const n=Number(line);if(n===-1)return{value:null,bytes:lineEnd+2};let offset=lineEnd+2,values=[];for(let i=0;i<n;i++){const p=parseReply(buffer.subarray(offset));if(!p)return null;offset+=p.bytes;if(p.error)throw p.error;values.push(p.value);}return{value:values,bytes:offset};}
  throw new Error('Unsupported Redis response type.');
}
export class RedisRespClient{
  constructor({url,connectTimeoutMs=3000,maxReplyBytes=MAX_REPLY_BYTES}={}){
    if(typeof url!=='string'||!url)throw new TypeError('Redis URL is required.');
    let parsed;try{parsed=new URL(url);}catch{throw new TypeError('Redis URL is invalid.');}
    if(!URL_PROTOCOLS.has(parsed.protocol))throw new TypeError('Redis URL must use redis:// or rediss://.');
    if(!Number.isInteger(connectTimeoutMs)||connectTimeoutMs<250||connectTimeoutMs>10000)throw new TypeError('Redis connect timeout is invalid.');
    this.url=parsed;this.connectTimeoutMs=connectTimeoutMs;this.maxReplyBytes=maxReplyBytes;this.socket=null;this.buffer=Buffer.alloc(0);this.pending=[];this.connected=false;this.connecting=null;
  }
  async connect(){
    if(this.connected&&this.socket&&!this.socket.destroyed)return;
    if(this.connecting)return this.connecting;
    this.connecting=new Promise((resolve,reject)=>{
      const secure=this.url.protocol==='rediss:',port=Number(this.url.port||6379);
      const socket=(secure?tls:net).connect({host:this.url.hostname,port,servername:secure?this.url.hostname:undefined},()=>{this.socket=socket;this.connected=true;this.connecting=null;resolve();});
      const timer=setTimeout(()=>socket.destroy(new Error('Redis connection timeout.')),this.connectTimeoutMs);
      const fail=e=>{clearTimeout(timer);this.connected=false;if(this.socket===socket)this.socket=null;this.#rejectAll(e);this.connecting=null;reject(e);};
      socket.once('error',fail);socket.once('close',()=>{clearTimeout(timer);this.connected=false;if(this.socket===socket)this.socket=null;});socket.on('data',chunk=>this.#onData(chunk));
    });
    await this.connecting;
    try{if(this.url.username||this.url.password)await this.command('AUTH',decodeURIComponent(this.url.username||'default'),decodeURIComponent(this.url.password||''));const db=this.url.pathname.replace(/^\//,'');if(db&&/^\d+$/.test(db)&&Number(db)>0)await this.command('SELECT',Number(db));}
    catch(e){this.disconnect(e);throw e;}
  }
  async command(...args){await this.connect();return new Promise((resolve,reject)=>{const item={resolve,reject};this.pending.push(item);try{this.socket.write(encodeCommand(args));}catch(e){this.pending.pop();reject(e);}});}
  async lpush(key,value){return this.command('LPUSH',key,value);}
  async brpop(...args){return this.command('BRPOP',...args);}
  disconnect(error=new Error('Redis client disconnected.')){if(this.socket&&!this.socket.destroyed)this.socket.destroy();this.connected=false;this.socket=null;this.#rejectAll(error);}
  #onData(chunk){this.buffer=Buffer.concat([this.buffer,chunk]);if(this.buffer.length>this.maxReplyBytes){this.disconnect(new Error('Redis reply exceeds configured bound.'));return;}while(this.buffer.length){let parsed;try{parsed=parseReply(this.buffer);}catch(e){this.disconnect(e);return;}if(!parsed)break;this.buffer=this.buffer.subarray(parsed.bytes);const item=this.pending.shift();if(!item)continue;if(parsed.error)item.reject(parsed.error);else item.resolve(parsed.value);}}
  #rejectAll(error){while(this.pending.length)this.pending.shift().reject(error);}
}
