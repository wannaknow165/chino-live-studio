import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {VideoDirector} from './video-director.mjs';
import {liveReadiness,filterLearningRecommendations} from './video-director-server.mjs';
import {autonomyCases} from './video-autonomy-cases.mjs';
import {VideoDecisionProvider} from './video-director-provider.mjs';
const clip={id:'7902c31ae1',text:'היי, מה קורה?',ready:true,file:'/greet.mp4'};
const play={action:'play',clipId:clip.id,text:clip.text,confidence:1,reason:'greeting',memoryUpdate:{summary:'הצופה מעוניין במוזיקה',facts:[]}};
function setup(extra={}){let t=100000;const outputs=[];const d=new VideoDirector({catalog:()=>[clip],providerStatus:()=>({configured:true}),context:()=>({}),decide:async()=>play,output:(type,data)=>outputs.push({type,...data}),now:()=>t,...extra});d.setRoom('room');d.setMode('rehearsal');return {d,outputs,advance:n=>t+=n};}
const event={type:'chat',text:'צינו שלום',uid:'viewer',name:'רוני',source:'tiktools'};
test('transcription declares the actual WAV or browser WebM format',async()=>{
 const provider=Object.create(VideoDecisionProvider.prototype);const uploads=[];
 provider.budget={finish(){}};provider.request=async(_endpoint,form)=>{uploads.push(form.get('file'));return {r:{json:async()=>({text:'heard'})},reservation:'test'};};
 const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
 await provider.transcribeAudio(wav.toString('base64'));await provider.transcribeAudio(Buffer.from([0x1a,0x45,0xdf,0xa3]).toString('base64'));
 assert.deepEqual(uploads.map(f=>[f.name,f.type]),[['speech.wav','audio/wav'],['speech.webm','audio/webm']]);
});
test('participant notes and literal evidence persist across turns and restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chino-memory-'));try{
  const file=path.join(dir,'state.json');const {d,advance}=setup({file,decide:async()=>({...play,memoryUpdate:{summary:'רוני אוהב גיטרה',facts:[{kind:'interest',value:'גיטרה',quote:'אני אוהב גיטרה'},{kind:'topic',value:'מידע מומצא',quote:'אין ציטוט כזה'}]}})});
  d.receive({...event,text:'צינו אני אוהב גיטרה'});await d.tick();const key=d.personKey({...event,room:'room'});d.updateMemory({key,note:'פנה אליו בשם רוני'});advance(16000);d.receive({...event,text:'צינו היי שוב'});
  const p=d.saved.people[key];assert.equal(p.operatorNote,'פנה אליו בשם רוני');assert.equal(p.facts.length,1);assert.equal(p.turns.length,2);
  const restarted=setup({file}).d;assert.equal(restarted.participantMemory({...event,room:'room'}).facts[0].quote,'אני אוהב גיטרה');assert.equal(restarted.participantMemory({...event,room:'other'}),null);assert.equal(restarted.participantMemory({...event,room:'room',uid:'different'}),null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('unknown participants never share persistent memories',()=>{const {d}=setup();d.receive({...event,uid:''});assert.equal(Object.keys(d.saved.people).length,0);assert.equal(d.participantMemory({...event,uid:''}),null);});
test('proposed speech is not recorded as something already spoken',async()=>{const {d}=setup();d.receive(event);await d.tick();assert.equal(d.participantMemory({...event,room:'room'}).recentTurns.some(t=>t.direction==='out'),false);});
test('rehearsal retains the two-minute conversation without inventing playback',async()=>{
 const {d,advance}=setup();d.receive({...event,type:'opponent',text:'צינו שלום'});await d.tick();
 advance(60000);assert.equal(d.receive({...event,type:'opponent',text:'יש לי עוד שאלה'}).accepted,true);
 assert.equal(d.lastRouting.reason,'conversation_followup');assert.equal(d.active,null);
 assert.equal(d.saved.history.some(h=>h.direction==='out'),false);
});
test('long exact self-audio echoes are rejected without rejecting brief legitimate answers',()=>{const {d}=setup();d.active={text:'נשיקות לכל הבנות שלנו'};assert.equal(d.isOwnEcho('נשיקות לכל הבנות שלנו!'),true);assert.equal(d.isOwnEcho('נשיקות לכולם מה שלומך'),false);assert.equal(d.isOwnEcho('מה קורה'),false);});
test('a new opponent turn can interrupt an existing opponent reply',async()=>{const {d,outputs}=setup();d.setMode('auto');d.heartbeat({id:'stage',ready:true});d.receive({...event,type:'opponent'});await d.tick();assert.ok(d.active);d.receive({...event,type:'opponent',text:'רגע צינו שאלה אחרת'});assert.equal(d.active,null);assert.equal(outputs.at(-1).reason,'opponent_interrupts');assert.equal(d.queue[0].type,'opponent');});
test('live readiness does not equate bridge connection with a live room or audible signal',()=>{
 const s={provider:{configured:true,budget:{limitUSD:10,reservedUSD:1}},stage:{ready:true},live:{audioConnected:true},context:{audienceConnection:{connected:true,on:true,status:'מתחבר…'}}};
 let r=liveReadiness(s);assert.equal(r.ready,false);assert.equal(r.checks.chat.ready,false);assert.equal(r.checks.audio.signalSeen,false);
 s.context.audienceConnection.status='מחובר ✓';r=liveReadiness(s);assert.equal(r.ready,true);assert.equal(r.checks.gpt.verifiedAt,0);
 s.provider.blocked='openai_authentication_failed';assert.equal(liveReadiness(s).ready,false);
});
test('decision measurements and missing meanings are grouped without mixing rooms',async()=>{const {d}=setup();d.receive(event);await d.tick();d.missing({id:'x',room:'room',type:'chat',text:'שאלה אחת',language:'he',uid:'a'},{text:'טיוטה'});d.missing({id:'y',room:'other',type:'chat',text:'שאלה אחרת',language:'he',uid:'b'},{text:'אחרת'});const r=d.learningReport();assert.equal(r.events,1);assert.equal(r.readyAnswers,1);assert.equal(r.gaps.length,1);assert.equal(r.gaps[0].question,'שאלה אחת');});
test('a participant asking for their own name cannot receive the character introduction',async()=>{
 const identity={id:'identity',text:'אני צינו',ready:true,file:'/identity.mp4'};
 const calls=[];const {d}=setup({catalog:()=>[identity],decide:async packet=>{calls.push(packet);return {...play,clipId:identity.id,text:identity.text};}});
 d.updateClip(identity.id,true,['chat','opponent']);
 await assert.rejects(d.choose({...event,room:'room',language:'he',text:'קוראים לי רוני, איך קוראים לי?'},new AbortController().signal),/decision_wrong_person/);
 assert.equal(calls.length,2);assert.equal(calls[1].validationFeedback,'wrong_person_name');assert.equal(d.active,null);
});
test('the semantic benchmark contains 100 unique fixed cases and no production action',()=>{assert.equal(autonomyCases.length,100);assert.equal(new Set(autonomyCases.map(c=>c.id)).size,100);assert.equal(autonomyCases.some(c=>c.generate),false);});
test('learning suggestions require a real audience gap and cannot duplicate a recording',()=>{
 const gaps=[{question:'מה נעשה עכשיו?'}],clips=[{text:'יאללה משחק.'}];
 const suggestions=[{question:'תחבר את המיקרופון',suggestedAnswer:'מחבר'},{question:gaps[0].question,suggestedAnswer:'יאללה משחק!'},{question:gaps[0].question,suggestedAnswer:'איזה נושא תרצו שנבחר?'},{question:gaps[0].question,suggestedAnswer:'איזה נושא תרצו שנבחר?'}];
 assert.deepEqual(filterLearningRecommendations(suggestions,gaps,clips),[suggestions[2]]);
});
test('accelerated thirty-minute rehearsal keeps one output owner and stops on loss of playback',async()=>{
 const {d,advance,outputs}=setup();d.setMode('auto');let played=0;
 for(let second=0;second<1800;second+=30){advance(30000);d.heartbeat({id:'stage',ready:true});if(second%120!==0)continue;d.receive({...event,uid:'viewer-'+second});await d.tick();if(d.active){const playId=d.active.playId;d.playback({playId,stageId:'stage',state:'started',duration:2});d.playback({playId,stageId:'stage',state:'ended'});played++;}}
 assert.equal(played,15);assert.equal(outputs.filter(x=>x.type==='play').length,15);assert.equal(d.active,null);assert.equal(d.mode,'auto');
 advance(120000);d.heartbeat({id:'stage',ready:true});d.receive({...event,uid:'lost'});await d.tick();advance(7000);await d.tick();assert.equal(d.mode,'manual');assert.equal(d.active,null);
});
