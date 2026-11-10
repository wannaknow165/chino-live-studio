import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoDirector} from './video-director.mjs';
const clip={id:'wellbeing',text:"I'm doing great. How about you?",ready:true,file:'/wellbeing.mp4'};
const event={id:'invite',type:'opponent',uid:'player',room:'room',language:'en',text:'want to battle?'};
const wrong={action:'play',clipId:clip.id,text:clip.text,confidence:.99,reason:'fits'};
test('existing English wellbeing audio cannot masquerade as a battle acceptance',async()=>{
 const packets=[];const d=new VideoDirector({catalog:()=>[clip],context:()=>({}),providerStatus:()=>({configured:true}),decide:async p=>{packets.push(p);return packets.length===1?wrong:{action:'draft',clipId:'',text:'Sure, let us battle.',confidence:1,reason:'missing'};}});d.updateClip(clip.id,true,['opponent']);
 const r=await d.choose({...event});assert.equal(packets[1].validationFeedback,'unrelated_battle_answer');assert.equal(r.action,'draft');assert.equal(r.text,'Sure, let us battle.');assert.equal(r.bankReview.noMatchConfirmed,true);
});
test('repeated wrong game answer is rejected without playback or a false production candidate',async()=>{
 const d=new VideoDirector({catalog:()=>[clip],context:()=>({}),providerStatus:()=>({configured:true}),decide:async()=>wrong});d.updateClip(clip.id,true,['opponent']);await assert.rejects(d.choose({...event}),/decision_wrong_game_answer/);assert.equal(d.saved.inbox.length,0);
});
