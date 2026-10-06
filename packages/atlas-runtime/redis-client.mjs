import net from 'node:net';
import tls from 'node:tls';

const MAX_FRAME=64_000;
const URL_RE=/^redis:\/\/([^@]+@)?([^/:]+)(?::(\\d+))?(\/\\d+)?$/i;
const RESP_ERROR=/^-([A-Z_]+) ?(.*)\\r\\n$/;

function parseUrl(value){
  if(typeof value!=='string'||!value.trim()) throw new TypeError('Redis URL is required.');
  const u=new URL(value);
  if(!['redis:','rediss:'].includes(u.protocol)) throw new TypeError('Redis URL must use redis:// or rediss://.');
  if(!u.hostname) throw new TypeError('Redis host is required.');
  const port=Number(u.port||6379);
  if(!Number.isInteger(port)||port<1||port>65535) throw new TypeError('Redis port is invalid.');
  const db=u.pathname&&u.pathname!=='/'?Number(u.pathname.slice(1)):0;
  if(!Number.isInteger(db)||db<0||db>65535) throw new TypeError('Redis database is invalid.');
  return {tls:u.protocol==='rediss:',host:u.hostname,port,db,password:u.password?decodeURIComponent(u.password):null,username:u.username?decodeURIComponent(u.username):null};
}

function encode(value){
  if(!Array.isArray(value)||!value.length) throw new TypeError('Redis command must be non-empty.');
  return Buffer.concat([Buffer.from('*'+value.length+'\\r\\n'),...value.map(v=>{const s=String(v);return Buffer.from('$'+Buffer.byteLength(s)+'\\r\\n'+s+'\\r\\n');})]);
}

function readFrame(buffer){
  if(!buffer.length) return null;
  const type=String.fromCharCode(buffer[0]);
  const end=buffer.indexOf('\\r\\n');
  if(end<0) return null;
  if(type==='+'||type==='-'||type===':'){
    const line=buffer.subarray(1,end).toString();
    if(type==='-'){const m=line.match(/^([A-Z_]+) ?(.*)$/);throw Object.assign(new Error(m?.[2]||line),{code:m?.[1]||'REDIS_ERROR'});}
    return {value:type===':'?Number(line):line,next:end+2};
  }
  if(type==='$'){
    const len=Number(buffer.subarray(1,end));
    if(len===-1) return {value:null,next:end+2};
    const start=end+2,finish=start+len;
    if(buffer.length<finish+2) return null;
    return {value:buffer.subarray(start,finish).toString(),next:finish+2};
  }
  if(type==='*'){
    const count=Number(buffer.subarray(1,end));
    if(count===-1) return {value:null,next:end+2};
    let offset=end+2; const values=[];
    for(let i=0;i<count;i++){const part=readFrame(buffer.subarray(offset));if(!part)return null;values.push(part.value);offset+=part.next;}
    return {value:values,next:offset};
  }
  throw new Error('Unsupported Redis RESP frame.');
}

class RedisConnection{
  constructor(options){this.options=options;this.socket=null;this.buffer=Buffer.alloc(0);this.waiters=[];this.connected=false;}
  async connect(){
    if(this.connected)return;
    this.socket=await new Promise((resolve,reject)=>{
      const s=this.options.tls
        ? tls.connect({host:this.options.host,port:this.options.port,servername:this.options.host,rejectUnauthorized:true})
        : net.createConnection({host:this.options.host,port:this.options.port});
      const fail=e=>{if(!this.connected)reject(e);for(const w of this.waiters.splice(0))w.reject(e);};
      s.once('error',fail);
      s.once(this.options.tls ? 'secureConnect' : 'connect',()=>resolve(s));
    });
    this.connected=true;
    this.socket.on('data',chunk=>this.#onData(chunk));
    this.socket.on('error',error=>{for(const w of this.waiters.splice(0))w.reject(error);this.connected=false;});
    this.socket.on('close',()=>{for(const w of this.waiters.splice(0))w.reject(new Error('Redis connection closed.'));this.connected=false;});
    if(this.options.password) await this.command(this.options.username?['AUTH',this.options.username,this.options.password]:['AUTH',this.options.password]);
    if(this.options.db) await this.command(['SELECT',this.options.db]);
  }
  #onData(chunk){
    this.buffer=Buffer.concat([this.buffer,chunk]);
    if(this.buffer.length>MAX_FRAME*4){for(const w of this.waiters.splice(0))w.reject(new Error('Redis response buffer exceeded safety bound.'));return;}
    while(this.waiters.length){const frame=readFrame(this.buffer);if(!frame)break;this.buffer=this.buffer.subarray(frame.next);this.waiters.shift().resolve(frame.value);}
  }
  async command(parts){
    await this.connect();
    return new Promise((resolve,reject)=>{this.waiters.push({resolve,reject});this.socket.write(encode(parts));});
  }
  async close(){if(this.socket){this.socket.end();this.socket=null;}this.connected=false;}
}

export function createRedisWakeupTransport(url,namespace='atlas'){
  const cfg=parseUrl(url);
  if(!/^[A-Za-z0-9_.:-]{1,80}$/.test(namespace)) throw new TypeError('Redis namespace is invalid.');
  const publisher=new RedisConnection(cfg),consumer=new RedisConnection(cfg);
  const key=queue=>`${namespace}:wake:${queue}`;
  return Object.freeze({
    async publish(queue,envelope){
      if(!/^[a-z][a-z0-9_.-]{1,79}$/.test(queue)) throw new TypeError('Redis queue is invalid.');
      const body=JSON.stringify(envelope);
      if(Buffer.byteLength(body)>MAX_FRAME) throw new TypeError('Redis wake envelope exceeds 64KiB.');
      return publisher.command(['LPUSH',key(queue),body]);
    },
    async receive(queues,timeoutSeconds=1){
      if(!Array.isArray(queues)||!queues.length) throw new TypeError('Redis queues are required.');
      const result=await consumer.command(['BRPOP',...queues.map(key),String(Math.max(1,Math.min(30,timeoutSeconds)))]);
      return result?JSON.parse(result[1]):null;
    },
    async close(){await Promise.allSettled([publisher.close(),consumer.close()]);}
  });
}

export { parseUrl as parseRedisUrl };