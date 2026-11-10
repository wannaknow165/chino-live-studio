import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoDirector} from './video-director.mjs';
function setup(hosting=true){let time=100000;const events=[];const context={hostSessionActive:hosting,audienceConnection:{on:false,connected:false}};const d=new VideoDirector({catalog:()=>[],context:()=>context,now:()=>time,providerStatus:()=>({configured:true}),decide:async p=>{events.push(p.event);return {action:'ignore',text:'',clipId:'',confidence:1,reason:'wait'};}});d.heartbeat({id:'stage',ready:true});d.setAudienceMode('solo');d.setMode('auto');return {d,events,context,advance(ms){time+=ms;d.heartbeat({id:'stage',ready:true});}};}
test('explicitly active host starts a room initiative without waiting eighteen seconds or pretending chat connected',async()=>{
 const {d,events,context}=setup();await d.tick();assert.equal(events.length,1);assert.equal(events[0].type,'audience');assert.equal(events[0].hostInitiated,true);assert.equal(context.audienceConnection.connected,false);
});
test('host can bridge quiet room gaps despite chat loss and still respects rate and speech holds',async()=>{
 const {d,events,advance}=setup();await d.tick();advance(11999);await d.tick();assert.equal(events.length,1);advance(1);d.hold('otherSpeaking',true);await d.tick();assert.equal(events.length,1);d.hold('otherSpeaking',false);await d.tick();assert.equal(events.length,2);advance(12000);d.hold('muted',true);await d.tick();assert.equal(events.length,2);
});
test('disconnected practice does not invent an audience and stopping the host disables autonomous room speech',async()=>{
 const {d,events,advance,context}=setup(false);advance(30000);await d.tick();assert.equal(events.length,0);context.hostSessionActive=true;await d.tick();assert.equal(events.length,1);context.hostSessionActive=false;advance(30000);await d.tick();assert.equal(events.length,1);d.setMode('manual');context.hostSessionActive=true;advance(30000);await d.tick();assert.equal(events.length,1);
});
