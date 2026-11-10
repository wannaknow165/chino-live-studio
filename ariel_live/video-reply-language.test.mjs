import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VideoDirector} from './video-director.mjs';
const event={id:'english-test',type:'opponent',language:'en',uid:'fixture',room:'room',text:'How are you doing?'};
const draft=text=>({action:'draft',clipId:'',text,fallbackText:text,confidence:1,reason:'missing',reusable:false});
test('English draft gets a language-specific recheck instead of teaching or producing a Hebrew answer',async()=>{
 const packets=[];const d=new VideoDirector({catalog:()=>[],context:()=>({}),providerStatus:()=>({configured:true}),decide:async p=>{packets.push(p);return draft(packets.length===1?'וואלה טוב, מה איתך?':'I am doing well. How about you?');}});
 const result=await d.choose({...event});assert.equal(packets[1].validationFeedback,'wrong_reply_language');assert.equal(packets[1].requiredReplyLanguage,'en');assert.equal(result.text,'I am doing well. How about you?');assert.equal(result.bankReview.passes,2);
});
test('repeated wrong-language output is rejected before it can become a production candidate',async()=>{
 const d=new VideoDirector({catalog:()=>[],context:()=>({}),providerStatus:()=>({configured:true}),decide:async()=>draft('אני בסדר, מה איתך?')});
 await assert.rejects(d.choose({...event}),/decision_language_mismatch/);assert.equal(d.saved.inbox.length,0);
});
test('cached Hebrew draft cannot override a fresh English answer for an English turn',()=>{
 const d=new VideoDirector({catalog:()=>[],context:()=>({})});
 const old=d.missing({...event},{text:'וואלה טוב, מה קורה אצלך?',reason:'old'});
 const next=d.missing({...event,id:'new-turn'},{text:'I am good, thanks. How are you?',reason:'fresh_review'});
 assert.equal(next.id,old.id);assert.equal(next.draft,'I am good, thanks. How are you?');assert.equal(next.draftRevisions[0].text,'וואלה טוב, מה קורה אצלך?');
});
test('Hebrew and English missing answers do not deduplicate into the same semantic row',()=>{
 const d=new VideoDirector({catalog:()=>[],context:()=>({})});
 const u={intent:'wellbeing',confidence:1,standalone:true};
 const he=d.missing({...event,language:'he',text:'מה שלומך?',understanding:{...u,canonicalQuestion:'מה שלומך?'}},{text:'טוב',reason:'he'});
 const en=d.missing({...event,understanding:{...u,canonicalQuestion:'how are you?'}},{text:'I am good.',reason:'en'});
 assert.notEqual(en.id,he.id);assert.equal(d.saved.inbox.length,2);
});
