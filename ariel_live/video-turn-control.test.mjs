import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoDirector} from './video-director.mjs';
const event={id:'yield-test',type:'opponent',language:'he',uid:'fixture',room:'room',text:'רגע תן לי לסיים לדבר'};
const decision=(intent='turn_yield',standalone=true,confidence=.99)=>({understanding:{intent,canonicalQuestion:event.text,standalone,confidence},action:'draft',clipId:'',text:'סבבה, אני מקשיב.',fallbackText:'סבבה, אני מקשיב.',confidence:1,reason:'acknowledge',reusable:false});
function setup(decide){return new VideoDirector({catalog:()=>[],context:()=>({}),providerStatus:()=>({configured:true}),decide});}
test('GPT-confirmed request to yield the turn is silence, never a missing paid acknowledgment',async()=>{
 let calls=0;const d=setup(async()=>{calls++;return decision();});const result=await d.choose({...event});
 assert.equal(result.action,'ignore');assert.equal(result.text,'');assert.equal(result.clipId,'');assert.equal(result.reason,'speaker_requests_listening');assert.equal(result.bankReview.noMatchConfirmed,false);assert.equal(calls,1);assert.equal(d.saved.inbox.length,0);
});
test('second bank review can discover a turn-control request without buying an acknowledgment',async()=>{
 let calls=0;const d=setup(async()=>++calls===1?decision('other'):decision());const result=await d.choose({...event});
 assert.equal(result.action,'ignore');assert.equal(result.bankReview.passes,2);assert.equal(result.bankReview.noMatchConfirmed,false);
});
test('uncertain or compound speech requests do not silence the show based on a keyword',async()=>{
 for(const [standalone,confidence] of [[false,.99],[true,.8]]){const d=setup(async()=>decision('turn_yield',standalone,confidence));const result=await d.choose({...event,text:'אל תפסיק לדבר, תסביר מה קורה'});assert.equal(result.action,'draft');}
});
test('yielding preserves follow-up recognition and a later new turn can resume',async()=>{
 let time=100000,calls=0;const answer={id:'answer',text:'וואלה פצצה.',ready:true,file:'/answer.mp4'};const d=new VideoDirector({catalog:()=>[answer],context:()=>({}),providerStatus:()=>({configured:true}),now:()=>time,decide:async()=>{calls++;return calls===1?decision():{...decision('other'),action:'play',clipId:answer.id,text:answer.text};}});d.updateClip('answer',true,['opponent']);
 d.setMode('auto');d.heartbeat({id:'stage',ready:true});d.receive({...event,text:'צינו רגע תן לי לסיים לדבר'});await d.tick();
 assert.equal(d.saved.inbox.length,0);assert.equal(d.dialogueStatus().state,'waiting');assert.equal(d.muted,false);time+=3000;d.heartbeat({id:'stage',ready:true});assert.equal(d.receive({...event,id:'next',text:'סיימתי, מה שלומך?'}).accepted,true);await d.tick();assert.equal(calls,2);assert.equal(d.active.clipId,answer.id);
});
test('a mislabeled game invitation gets a fresh review instead of being silenced',async()=>{
 const packets=[];const clip={id:'game',text:'יאללה משחק.',ready:true,file:'/game.mp4'};
 const d=new VideoDirector({catalog:()=>[clip],context:()=>({}),providerStatus:()=>({configured:true}),decide:async p=>{packets.push(p);return packets.length===1?decision():{...decision('other'),action:'play',clipId:'game',text:clip.text};}});d.updateClip('game',true,['chat','opponent']);
 const result=await d.choose({...event,text:'אפשר להזמין אותך לבאטל?'});assert.equal(packets[1].validationFeedback,'unsupported_turn_control');assert.equal(result.action,'play');assert.equal(result.text,clip.text);
});
test('repeated unsupported silence classification is rejected before it can be remembered',async()=>{
 const d=setup(async()=>decision());await assert.rejects(d.choose({...event,text:'אפשר להזמין אותך לבאטל?'}),/decision_turn_control_mismatch/);assert.equal(d.saved.inbox.length,0);
});
