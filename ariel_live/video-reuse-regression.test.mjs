import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoDirector} from './video-director.mjs';
import {semanticGapKey} from './video-answer-index.mjs';
const clip={id:'reuse-142a64471ef9',text:'יאללה משחק.',file:'/game.mp4',ready:true};
const input={id:'turn',type:'opponent',room:'room',uid:'player',language:'he',text:'צינו בא לך באטל?'};
function setup(){let time=1000000,calls=0;const clips=[clip];let packet;
 const director=new VideoDirector({now:()=>time,catalog:()=>clips,context:()=>({}),providerStatus:()=>({configured:true}),output:()=>{},decide:async p=>{calls++;packet=p;return {action:'play',clipId:clip.id,text:clip.text,confidence:1,reason:'fits',reusable:false};}});
 director.setRoom('room');director.updateClip(clip.id,true,['chat','opponent']);
 return {director,clips,get packet(){return packet;},get calls(){return calls;},advance:n=>time+=n};
}
test('recent playback never hides an existing battle answer from either semantic bank scan',async()=>{
 const s=setup(),d=s.director;d.saved.history.push({direction:'out',room:'room',uid:input.uid,clipId:clip.id,text:clip.text,t:999000});
 assert.equal(d.eligible(input).length,0);assert.equal(d.eligible(input,{semanticReview:true}).length,1);
 const decision=await d.choose({...input});assert.equal(decision.action,'ignore');assert.equal(decision.reason,'existing_answer_cooldown');assert.equal(decision.bankReview.matchedClipId,clip.id);assert.ok(s.packet.candidates[0].cooldownRemainingMs>0);assert.equal(decision.bankReview.libraryRevision,d.bankRevision(input));
 await d.choose({...input,id:'next'});assert.equal(s.calls,2);
});
test('bank revision changes with real inventory or permissions, not with temporary repetition cooldown',()=>{
 const {director:d,clips,advance}=setup(),initial=d.bankRevision(input);
 d.saved.history.push({direction:'out',room:'room',clipId:clip.id,t:1000000});advance(10000);assert.equal(d.bankRevision(input),initial);
 clips.push({id:'new',text:'עוד תשובה',ready:true,file:'/new.mp4'});d.updateClip('new',true,['opponent']);assert.notEqual(d.bankRevision(input),initial);
 const expanded=d.bankRevision(input);d.updateClip('new',false,['opponent']);assert.notEqual(d.bankRevision(input),expanded);
});
test('safe equivalent drafts share a production meaning but personal, compound and role contexts do not',()=>{
 const e={...input,understanding:{intent:'wellbeing',canonicalQuestion:'מה שלומך?',standalone:true,confidence:.99}};
 const key=semanticGapKey(e,'וואלה מצוין');assert.ok(key);assert.equal(semanticGapKey({...e,uid:'another',text:'מה המצב אח שלי'},'הכל טוב'),key);
 for(const change of [{room:'other'},{type:'chat'},{language:'en'}])assert.notEqual(semanticGapKey({...e,...change},'הכל טוב'),key);
 assert.equal(semanticGapKey(e,'מעולה מאיה, מה איתך?'),null);
 assert.equal(semanticGapKey({...e,understanding:{...e.understanding,standalone:false}},'הכל טוב'),null);
});
