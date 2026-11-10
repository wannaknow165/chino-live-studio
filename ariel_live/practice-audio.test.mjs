import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import {createVideoDirector} from './video-director-server.mjs';
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chino-audio-rehearsal-'));
 const system=createVideoDirector({root,bank:()=>[],emit:()=>{},context:()=>({}),onMode:()=>{},onSpoken:()=>{},productionEnabled:true});
 t.after(()=>{system.close();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 system.provider.setKey('sk-'+ 'test'.repeat(20));let calls=0;
 system.provider.transcribeAudio=async()=>{calls++;return 'מה שלומך';};
 const call=async(route,body)=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.headers={host:'127.0.0.1:7777','content-type':'application/json'};let status,value;await system.handle(req,{writeHead:s=>status=s,end:s=>{value=JSON.parse(s);}},route);return {status,value};};
 return {system,call,calls:()=>calls};
}
test('recorded rehearsal audio is rejected in live input mode before transcription or spending',async t=>{
 const {call,calls}=setup(t);const r=await call('/api/director/practice/audio',{fixtureId:'fixture-he-001',b64:'YXVkaW8='});assert.equal(r.value.accepted,false);assert.equal(r.value.reason,'practice_audio_requires_practice_mode');assert.equal(calls(),0);
});
test('audio fixture uses the real transcription pipeline but retains fixture provenance and never marks mic connected',async t=>{
 const {call,system,calls}=setup(t);await call('/api/director/input/practice',{});
 const r=await call('/api/director/practice/audio',{fixtureId:'fixture-he-001',b64:'YXVkaW8=',source:'microphone'});
 assert.equal(r.value.accepted,true);assert.equal(r.value.inputSource,'practice_audio');assert.equal(calls(),1);
 const event=system.director.saved.history.at(-1);assert.equal(event.source,'practice_audio');assert.equal(event.fixtureId,'fixture-he-001');assert.equal(event.addressedBy,'recorded_audio_practice');
 const s=await call('/api/director/mode',{mode:'manual'});assert.equal(s.status,200);
});
test('fixture identity is required and invalid audio never reaches the provider',async t=>{
 const {call,calls}=setup(t);await call('/api/director/input/practice',{});
 const r=await call('/api/director/practice/audio',{fixtureId:'bad',b64:'YXVkaW8='});assert.equal(r.status,400);assert.equal(calls(),0);
 const invalid=await call('/api/director/practice/audio',{fixtureId:'fixture-he-001',b64:'not base64!'});assert.equal(invalid.status,400);assert.equal(calls(),0);
});
