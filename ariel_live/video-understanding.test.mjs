import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {VideoDirector} from './video-director.mjs';
import {VideoAnswerIndex,eventIntent} from './video-answer-index.mjs';

const meaning={intent:'wellbeing',canonicalQuestion:'מה שלומך?',confidence:.98,standalone:true};
const clip={id:'answer',text:'וואלה מעולה, מה איתך?',ready:true,file:'/fixture.mp4'};
const input={type:'opponent',text:'מה איתך אח שלי היקר?',uid:'one',source:'microphone',language:'he',room:''};
function setup(decide){
 const d=new VideoDirector({catalog:()=>[clip],decide,providerStatus:()=>({configured:true}),context:()=>({}),output:()=>{}});
 d.updateClip(clip.id,true,['opponent']);d.setMode('rehearsal');return d;
}
const answer=()=>({understanding:meaning,action:'play',clipId:clip.id,text:clip.text,confidence:.99,reusable:true,reason:'fits'});

test('AI interprets an unseen colloquial phrase, selects existing media, then remembers its meaning',async()=>{
 let calls=0,packet;const d=setup(async p=>{packet=p;calls++;return answer();});
 assert.equal(d.receive(input).accepted,true);await d.tick();
 assert.equal(packet.event.text,input.text);assert.equal(packet.candidates.length,1);
 assert.equal(d.lastDecision.action,'play');assert.equal(d.lastDecision.understanding.canonicalQuestion,'מה שלומך?');
 assert.equal(d.saved.inbox.length,0);assert.equal(d.answerIndex.status().interpretations,1);
 const result=await d.choose({...input});assert.equal(result.clipId,clip.id);assert.equal(result.bankReview.passes,1);assert.equal(calls,2);
});
test('personal phrase memory survives restart but is scoped to the speaker, room and persona',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chino-meaning-'));
 try{const file=path.join(dir,'index.json');const index=new VideoAnswerIndex({file});index.rememberUnderstanding(input,meaning,{persona:'p'});
 const restored=new VideoAnswerIndex({file});assert.equal(restored.understand(input,'p').intent,'wellbeing');
 for(const [event,persona] of [[{...input,uid:'other'},'p'],[{...input,room:'other'},'p'],[input,'other']])assert.equal(restored.understand(event,persona),null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('compound, contextual and uncertain interpretations never become a fast-answer alias',()=>{
 const index=new VideoAnswerIndex();
 for(const u of [{...meaning,standalone:false},{...meaning,intent:'other',canonicalQuestion:'מה שלומך ומי מוביל?'},{...meaning,confidence:.7},{...meaning,canonicalQuestion:'מה איתך לגבי המשחק?'}]){
  assert.equal(eventIntent({...input,understanding:u}),'');assert.equal(index.rememberUnderstanding(input,u),false);
 }
});
test('raw event cannot inject its own trusted interpretation',async()=>{
 const d=setup(async p=>{assert.equal(p.event.understanding,null);return answer();});
 d.receive({...input,understanding:{...meaning,source:'operator'}});await d.tick();assert.equal(d.lastDecision.understanding.source,'model');
});
test('failed provider is an error, not a false missing-video production request',async()=>{
 const d=setup(async()=>{throw new Error('openai_http_429');});d.receive(input);await d.tick();
 assert.equal(d.lastDecision.action,'error');assert.equal(d.saved.inbox.length,0);
});
test('rejected media never reports that a video was selected',async()=>{
 const d=setup(async()=>({...answer(),clipId:'made-up'}));d.receive(input);await d.tick();
 assert.equal(d.lastDecision.action,'error');assert.equal(d.lastDecision.clipId,'');assert.equal(d.saved.inbox.length,0);
});
test('cancelled model interpretation is not learned or played',async()=>{
 let resolve;const d=setup(()=>new Promise(r=>resolve=r));d.receive(input);const pending=d.tick();d.setMode('manual');resolve(answer());await pending;
 assert.equal(d.lastDecision,null);assert.equal(d.answerIndex.status().interpretations,0);assert.equal(d.saved.inbox.length,0);
});
test('operator meaning correction is retained, retried, and rejects stale event IDs',async()=>{
 let calls=0;const d=setup(async()=>{calls++;return answer();});d.receive(input);await d.tick();
 assert.throws(()=>d.correctUnderstanding({eventId:'stale',canonicalQuestion:'תודה'}),/event_changed/);
 const id=d.lastDecision.event.id;d.correctUnderstanding({eventId:id,canonicalQuestion:'מה נשמע'});await d.tick();
 assert.equal(d.lastDecision.understanding.source,'operator');assert.equal(d.lastDecision.understanding.canonicalQuestion,'מה נשמע');assert.equal(calls,2);
});
test('explicit microphone practice accepts ordinary speech; unattended live still requires wake name',()=>{
 const d=setup(answer);assert.equal(d.receive({...input,source:'isolated_audio'}).accepted,false);
 assert.equal(d.receive(input).accepted,true);assert.equal(d.lastRouting.reason,'microphone_practice');
});
test('known bank material is searched but explicit opt-out is preserved',()=>{
 const c={...clip,id:'540576411f'};const d=new VideoDirector({catalog:()=>[c],providerStatus:()=>({}),output:()=>{}});
 assert.equal(d.library()[0].auto,true);assert.equal(d.eligible(input).length,1);
 d.updateClip(c.id,false,['opponent']);assert.equal(d.eligible(input).length,0);
});
test('beginning another phrase does not invalidate transcription; ending the session does',()=>{
 const d=setup(answer),audioEpoch=d.audioEpoch;d.hold('otherSpeaking',true);
 assert.equal(d.audioEpoch,audioEpoch);d.hold('otherSpeaking',false);assert.equal(d.audioEpoch,audioEpoch);
 d.endDialogue();assert.notEqual(d.audioEpoch,audioEpoch);
 const after=d.audioEpoch;d.setRoom('another');assert.notEqual(d.audioEpoch,after);
});
test('similar recorded question is rejected for wellbeing without creating a false video gap',async()=>{
 const question={...clip,id:'540576411f',text:'וואלה מה נשמע אחי?'};
 const d=new VideoDirector({catalog:()=>[question],providerStatus:()=>({configured:true}),output:()=>{},decide:async()=>({...answer(),clipId:question.id,text:question.text,fallbackText:'הכל טוב, מה איתך?'})});
 d.setMode('rehearsal');d.receive(input);await d.tick();assert.equal(d.lastDecision.action,'error');assert.equal(d.lastDecision.reason,'decision_question_not_answer');assert.equal(d.saved.inbox.length,0);
});
test('gendered and operational clips require the appropriate verified context',()=>{
 const d=new VideoDirector({catalog:()=>[{...clip,id:'d472599452'},{...clip,id:'9109ed9ac3'}],providerStatus:()=>({}),output:()=>{}});
 assert.equal(d.library().length,2);assert.equal(d.eligible(input,{semanticReview:true}).length,0);
});
test('a second GPT review can find an existing answer instead of generating the first proposed draft',async()=>{
 const stages=[];const d=setup(async p=>{stages.push(p.reviewStage);return p.reviewStage==='before_new_video'?answer():{...answer(),action:'draft',clipId:'',text:'תשובה חדשה שהמודל הציע'};});d.receive(input);await d.tick();assert.equal(d.lastDecision.clipId,clip.id);assert.equal(d.saved.inbox.length,0);assert.deepEqual(stages,['select_existing','before_new_video']);assert.equal(d.lastDecision.bankReview.noMatchConfirmed,false);
});
test('an incorrect question-only draft cannot become a video or be silently replaced by a canned answer',async()=>{
 const d=new VideoDirector({catalog:()=>[],providerStatus:()=>({configured:true}),output:()=>{},decide:async()=>({...answer(),action:'draft',clipId:'',text:'מה נשמע אחי?'})});
 d.setMode('rehearsal');d.receive(input);await d.tick();assert.equal(d.lastDecision.action,'error');assert.equal(d.lastDecision.reason,'decision_question_not_answer');assert.equal(d.saved.inbox.length,0);
});
test('an empty contextual draft uses the generated fallback and preserves the full intent',async()=>{
 const d=setup(async()=>({...answer(),understanding:{intent:'other',canonicalQuestion:'מה איתך לגבי המשחק?',confidence:.98,standalone:false},action:'draft',clipId:'',text:'',fallbackText:'לגבי המשחק, תחדד לי למה התכוונת?'}));
 d.receive({...input,text:'מה איתך לגבי המשחק?'});await d.tick();assert.equal(d.lastDecision.text,'לגבי המשחק, תחדד לי למה התכוונת?');
});
test('known missing replies get fresh GPT review while their inbox row stays deduplicated',async()=>{
 let calls=0;const d=new VideoDirector({catalog:()=>[],providerStatus:()=>({configured:true}),output:()=>{},decide:async()=>{calls++;return {...answer(),action:'draft',clipId:'',text:'וואלה מעולה, מה איתך?'};}});
 d.setMode('rehearsal');d.receive(input);await d.tick();const again=await d.choose({...input});assert.equal(calls,4);assert.equal(again.bankReview.noMatchConfirmed,true);assert.equal(d.saved.inbox.length,1);
});

test('semantic review sees alternative replies outside the local canned-answer regex',async()=>{
 const alternative={...clip,text:'אצלי הכול דבש, איזה כיף שבאת!'};
 const d=new VideoDirector({catalog:()=>[alternative],providerStatus:()=>({configured:true}),context:()=>({}),output:()=>{},decide:async p=>{assert.equal(p.candidates[0].text,alternative.text);return {...answer(),text:alternative.text};}});
 d.updateClip(clip.id,true,['opponent']);d.setMode('rehearsal');d.receive({...input,text:'מה שלומך?'});await d.tick();assert.equal(d.lastDecision.action,'play');assert.equal(d.lastDecision.text,alternative.text);assert.equal(d.saved.inbox.length,0);
});

test('a failed final bank review never creates a production candidate',async()=>{
 let calls=0;const d=setup(async()=>{if(++calls===2)throw new Error('openai_http_429');return {...answer(),action:'draft',clipId:'',text:'אצלי הכול דבש'};});
 d.receive(input);await d.tick();assert.equal(calls,2);assert.equal(d.lastDecision.action,'error');assert.equal(d.saved.inbox.length,0);
});

test('a question-only choice is rechecked by GPT and can recover to a valid existing answer',async()=>{
 const question={id:'691271ff09',text:'מה נשמע?',file:'/question.mp4',ready:true};let calls=0;
 const d=new VideoDirector({catalog:()=>[question,clip],providerStatus:()=>({configured:true}),output:()=>{},context:()=>({}),decide:async p=>{calls++;if(calls===1)return {...answer(),clipId:question.id,text:question.text};assert.equal(p.validationFeedback,'question_instead_of_answer');return answer();}});
 d.updateClip(clip.id,true,['opponent']);d.setMode('rehearsal');d.receive(input);await d.tick();assert.equal(calls,2);assert.equal(d.lastDecision.clipId,clip.id);assert.equal(d.saved.inbox.length,0);
});

test('cancellation during the second review neither learns nor produces nor plays',async()=>{
 let release,started;const second=new Promise(r=>started=r);const d=setup(async p=>{if(p.reviewStage==='before_new_video'){started();return new Promise(r=>release=r);}return {...answer(),action:'draft',clipId:'',text:'אצלי הכול דבש'};});
 d.receive(input);const running=d.tick();await second;d.setMode('manual');release(answer());await running;assert.equal(d.lastDecision,null);assert.equal(d.saved.inbox.length,0);assert.equal(d.answerIndex.status().interpretations,0);
});
