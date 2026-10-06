import crypto from 'node:crypto';

const REF=/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$/;
const CODEC=new Set(['pcm16','mulaw8','opus']);
const MAX_FRAME_BYTES=64*1024;
const MAX_FRAMES=6000;
const sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ref=(v,l)=>{if(typeof v!=='string'||!REF.test(v))throw new TypeError(l+' invalid');return v;};
const int=(v,l,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw new TypeError(l+' out of bounds');return v;};

export function createVoiceStreamSession({tenantId,voiceSessionRef,codec='pcm16',sampleRate=8000,channels=1,maxDurationMs=30*60_000,maxFrameBytes=32*1024}={}){
 ref(tenantId,'tenantId');ref(voiceSessionRef,'voiceSessionRef');
 if(!CODEC.has(codec))throw new TypeError('unsupported voice codec');
 int(sampleRate,'sampleRate',8000,48000);int(channels,'channels',1,2);int(maxDurationMs,'maxDurationMs',30_000,30*60_000);int(maxFrameBytes,'maxFrameBytes',1024,MAX_FRAME_BYTES);
 const body={tenantId,voiceSessionRef,codec,sampleRate,channels,maxDurationMs,maxFrameBytes,startedAt:Date.now()};
 return Object.freeze({...body,sessionChecksum:sha(body)});
}

export function acceptVoiceAudioFrame({session,frame,receivedAt=Date.now(),frameIndex}={}){
 if(!session||session.tenantId!==frame?.tenantId||session.voiceSessionRef!==frame?.voiceSessionRef)throw new Error('voice frame scope mismatch');
 int(frameIndex,'frameIndex',0,MAX_FRAMES-1);
 if(!Number.isSafeInteger(receivedAt)||receivedAt<session.startedAt||receivedAt>session.startedAt+session.maxDurationMs+5000)throw new Error('voice frame outside session window');
 if(typeof frame?.encoding!=='string'||frame.encoding!==session.codec)throw new Error('voice codec mismatch');
 if(typeof frame?.audioBase64!=='string'||!frame.audioBase64)throw new Error('voice audio frame required');
 let bytes;try{bytes=Buffer.from(frame.audioBase64,'base64');}catch{throw new Error('voice audio encoding invalid');}
 if(bytes.length<1||bytes.length>session.maxFrameBytes)throw new Error('voice frame size exceeded');
 return Object.freeze({tenantId:session.tenantId,voiceSessionRef:session.voiceSessionRef,frameIndex,bytes:bytes.length,audioStored:false,acceptedAt:new Date(receivedAt).toISOString(),frameHash:crypto.createHash('sha256').update(bytes).digest('hex')});
}

export function createVoiceStreamEvent({tenantId,voiceSessionRef,type,sequence,payloadRef=null,frameHash=null,now=Date.now()}={}){
 ref(tenantId,'tenantId');ref(voiceSessionRef,'voiceSessionRef');ref(type,'type');int(sequence,'sequence',0,MAX_FRAMES*2);
 if(payloadRef!==null)ref(payloadRef,'payloadRef');
 if(frameHash!==null&&!/^[a-f0-9]{64}$/.test(frameHash))throw new TypeError('frameHash invalid');
 return Object.freeze({tenantId,voiceSessionRef,type,sequence,payloadRef,frameHash,occurredAt:new Date(Number(now)).toISOString(),payloadStored:false,eventHash:sha({tenantId,voiceSessionRef,type,sequence,payloadRef,frameHash})});
}
