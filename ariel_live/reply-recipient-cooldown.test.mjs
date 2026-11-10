import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoDirector} from './video-director.mjs';
const clip={id:'game',text:'יאללה משחק.',ready:true,file:'/game.mp4'};
function setup(){const packets=[];const d=new VideoDirector({catalog:()=>[clip],context:()=>({}),now:()=>100000,providerStatus:()=>({configured:true}),decide:async p=>{packets.push(p);return {action:'play',clipId:clip.id,text:clip.text,confidence:.99,reason:'game_invitation'};}});d.updateClip(clip.id,true,['chat','opponent','audience']);d.saved.history.push({direction:'out',room:'room',uid:'viewer-a',clipId:clip.id,text:clip.text,t:99000});return {d,packets};}
const event={id:'new-invitation',room:'room',uid:'viewer-b',type:'opponent',text:'אפשר להזמין אותך לבאטל?',language:'he'};
test('a new participant can receive an existing answer immediately instead of inheriting another viewer cooldown',async()=>{
 const {d,packets}=setup();const r=await d.choose({...event});assert.equal(r.action,'play');assert.equal(packets[0].candidates[0].cooldownRemainingMs,0);assert.equal(r.bankReview.cooldownRemainingMs,0);
});
test('same participant and unidentified audience still retain repetition protection',async()=>{
 for(const uid of ['viewer-a','']){const {d}=setup();const r=await d.choose({...event,uid});assert.equal(r.action,'ignore');assert.equal(r.reason,'existing_answer_cooldown');assert.equal(d.saved.inbox.length,0);}
});
