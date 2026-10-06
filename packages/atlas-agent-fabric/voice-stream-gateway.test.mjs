import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceStreamSession,acceptVoiceAudioFrame,createVoiceStreamEvent} from './voice-stream-gateway.mjs';
const T='11111111-1111-4111-8111-111111111111';
test('V152 voice stream enforces codec, frame and session boundaries',()=>{
 const session=createVoiceStreamSession({tenantId:T,voiceSessionRef:'voice-session-stream',codec:'pcm16',sampleRate:16000,maxFrameBytes:1024,startedAt:Date.now()});
 const result=acceptVoiceAudioFrame({session,frame:{tenantId:T,voiceSessionRef:session.voiceSessionRef,encoding:'pcm16',audioBase64:Buffer.from('audio').toString('base64')},frameIndex:0,receivedAt:session.startedAt+1});
 assert.equal(result.audioStored,false);assert.equal(result.bytes,5);
 assert.throws(()=>acceptVoiceAudioFrame({session,frame:{tenantId:T,voiceSessionRef:session.voiceSessionRef,encoding:'opus',audioBase64:'YQ=='},frameIndex:1,receivedAt:session.startedAt+2}),/codec/);
});
test('V152 voice stream evidence stores hashes not audio',()=>{
 const event=createVoiceStreamEvent({tenantId:T,voiceSessionRef:'voice-session-stream',type:'audio.accepted',sequence:1,frameHash:'a'.repeat(64)});
 assert.equal(event.payloadStored,false);assert.equal(event.frameHash,'a'.repeat(64));assert.equal('audioBase64' in event,false);
});
