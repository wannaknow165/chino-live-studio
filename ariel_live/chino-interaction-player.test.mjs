import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {ChinoInteractions} from './chino-interactions.mjs';
import {ChinoInteractionPlayer} from './chino-interaction-player.mjs';
import {VideoDirector} from './video-director.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chino-queue-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(url,bytes)=>{const file=path.join(root,url.slice(1));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return sha(bytes);};
  const baseVideoUrl='/media/generated/lion.mp4',baseVideoSha256=write(baseVideoUrl,'approved-base');
  const template={version:1,preset:'chicken_comb_hold',enabled:true,approvalScope:'operator_approved_output',approvedForIntegratedOutput:true,publicApproved:false,baseVideoUrl,baseVideoSha256,profile:{version:1,reviewed:true,sourceFile:'lion.mp4',duration:8.042667,overlayStartTime:3,holdBaseLoop:{from:4,to:5.5},handTrack:[[0,.8,.7],[8.042667,.8,.7]],occluderTrack:[]}};
  const templateUrl='/media/interactions/templates/chicken_comb_hold.json',saveTemplate=()=>write(templateUrl,JSON.stringify(template));saveTemplate();
  const interactions=new ChinoInteractions({root,probe:()=>{throw new Error('no_probe');}});let time=100000,player;const outputs=[];
  const d=new VideoDirector({catalog:()=>[],decide:()=>{throw new Error('no_provider');},providerStatus:()=>({configured:false}),output:(type,data)=>{outputs.push({type,...data});player?.observe('director-'+type,data);},emit:(type,data)=>player?.observe(type,data),now:()=>time});
  d.heartbeat({id:'owner-stage',ready:true});
  player=new ChinoInteractionPlayer({root,interactions,director:d,now:()=>time});
  const add=(id,{badFlags=false,video='same-video',sourceName='face.webm',preset='chicken_comb_hold'}={})=>{
    const url='/media/interactions/incoming/'+id+'.webm',videoSha=write(url,video),trackUrl='/media/interactions/incoming/'+id+'.grab.json';
    const raw={version:1,file:sourceName,width:400,height:736,fps:24,frames:97,track:Array.from({length:97},(_,i)=>[i/24,.5,.15]),detected:Array.from({length:97},(_,i)=>!(badFlags&&i===50))};
    const trackSha=write(trackUrl,JSON.stringify(raw));const row={id,requestId:'request-'+id,preset,participant:{id:'face-'+id},asset:{url,sourceUrl:'/media/overlays/'+sourceName,sha256:videoSha,width:400,height:736,durationSeconds:4.042,alpha:true,tracking:{...raw,url:trackUrl,sha256:trackSha}},state:'awaiting_lion_motion',rendered:false,fingerprint:id};
    interactions.save([...interactions.requests,row]);return row;
  };
  return {root,write,template,saveTemplate,interactions,d,player,outputs,add,now:()=>time,advance:ms=>{time+=ms;d.heartbeat({id:'owner-stage',ready:true});}};
}
test('sender queues exact approved snapshot then only output owner ACK confirms playback; retry does not duplicate',t=>{
  const f=fixture(t),row=f.add('one');const accepted=f.player.enqueue(row.id);assert.equal(accepted.queued,true);assert.equal(accepted.rendered,false);assert.equal(f.outputs.length,0);
  f.player.tick();const message=f.outputs.at(-1);assert.equal(message.type,'play');assert.equal(message.file,f.template.baseVideoUrl);assert.equal(message.repeatCount,2);assert.equal(message.expectedDuration,14.042667);assert.equal(message.expires-f.now(),15000);assert.equal(f.player.row(row.id).state,'queued');
  assert.equal(f.d.playback({stageId:'another',playId:message.playId,state:'started'}).accepted,false);assert.equal(f.player.row(row.id).rendered,false);
  f.d.playback({stageId:'owner-stage',playId:message.playId,state:'ended'});assert.equal(f.player.row(row.id).state,'queued');
  f.d.playback({stageId:'owner-stage',playId:message.playId,state:'started',duration:14.042667});assert.equal(f.player.row(row.id).state,'playing');assert.equal(f.player.row(row.id).rendered,true);
  f.d.playback({stageId:'owner-stage',playId:message.playId,state:'ended'});assert.equal(f.player.row(row.id).state,'completed');
  f.player.enqueue(row.requestId);f.player.tick();assert.equal(f.outputs.length,1);
  const scene=JSON.parse(fs.readFileSync(path.join(f.root,message.interactionScene.slice(1))));assert.deepEqual(scene.profile.sourceWindow,{from:0,to:4.042});assert.equal(scene.participant.id,'face-one');
});
test('busy conversation holds effect queue and director failure/cancel never claims completed',t=>{
  const f=fixture(t),row=f.add('one');f.player.enqueue(row.id);f.d.busy=true;f.player.tick();assert.equal(f.outputs.length,0);f.d.busy=false;f.d.otherSpeaking=true;f.player.tick();assert.equal(f.outputs.length,0);f.d.otherSpeaking=false;f.player.tick();const message=f.outputs.at(-1);
  f.d.playback({stageId:'owner-stage',playId:message.playId,state:'failed'});assert.equal(f.player.row(row.id).state,'failed');assert.equal(f.player.row(row.id).rendered,false);
  const two=f.add('two');f.player.enqueue(two.id);f.player.tick();f.d.cancel('operator_stop');assert.equal(f.player.row(two.id).state,'failed');assert.equal(f.player.row(two.id).playback.reason,'operator_stop');
});
test('only reviewed identical video reuses approved tracking; different faces remain awaiting review',t=>{
  const f=fixture(t);f.add('reviewed');const same=f.add('same',{badFlags:true});assert.equal(f.player.enqueue(same.id).queued,true);assert.equal(f.player.row(same.id).asset.trackingReusedFrom,'reviewed');
  const other=f.add('other',{badFlags:true,video:'different-face'});assert.equal(f.player.enqueue(other.id).state,'awaiting_review');assert.equal(f.player.row(other.id).asset.trackingReusedFrom,undefined);
  const baby=f.add('baby',{preset:'baby_bottle_feed'});assert.equal(f.player.enqueue(baby.id).state,'awaiting_lion_motion');
});
test('disabled template, tampered immutable asset, and template disable after queue fail closed',t=>{
  const f=fixture(t),row=f.add('one');f.template.enabled=false;f.saveTemplate();assert.equal(f.player.enqueue(row.id).queued,false);f.template.enabled=true;f.saveTemplate();assert.equal(f.player.enqueue(row.id).queued,true);
  f.write(row.asset.url,'tampered-face');f.player.tick();assert.equal(f.outputs.length,0);assert.equal(f.player.row(row.id).playback.reason,'interaction_snapshot_changed');
  const two=f.add('two');f.player.enqueue(two.id);f.template.enabled=false;f.saveTemplate();f.player.tick();assert.equal(f.outputs.length,0);assert.equal(f.player.row(two.id).state,'failed');
});
test('restart does not replay queued or playing effects; metadata rejects arbitrary paths',t=>{
  const f=fixture(t),row=f.add('one');f.player.enqueue(row.id);new ChinoInteractionPlayer({root:f.root,interactions:f.interactions,director:f.d});assert.equal(f.player.row(row.id).playback.reason,'interaction_restart_interrupted');f.player.tick();assert.equal(f.outputs.length,0);
  assert.throws(()=>f.d.play({id:'raw',text:'',file:'/x.mp4'},{},{interactionScene:'https://evil/x.json',repeatCount:2,expectedDuration:14}),/invalid_interaction_play_metadata/);
});
function enableAudio(f,{changeSource=false,badAlpha=false,badDuration=false}={}){
  f.write('/data/ovsrc/face.mp4','original-aac');let calls=0;
  f.player.probe=async file=>file.endsWith('.mp4')?{format:{duration:badDuration?9:4.041667},streams:[{codec_type:'audio',codec_name:'aac'}]}:{format:{duration:4.042},streams:[{codec_type:'video',width:400,height:736,tags:{alpha_mode:badAlpha?'0':'1'}},{codec_type:'audio',codec_name:'opus'}]};
  f.player.convertAudio=async({output})=>{calls++;fs.writeFileSync(output,'derivative-'+calls);if(changeSource)f.write('/data/ovsrc/face.mp4','source-changed');};
  return ()=>calls;
}
test('restores original sound asynchronously while preserving immutable alpha and track, then reuses exact source',async t=>{
  const f=fixture(t),calls=enableAudio(f),row=f.add('audio-one');const result=f.player.enqueue(row.id);assert.equal(result.state,'preparing_audio');assert.equal(result.queued,false);assert.equal(f.outputs.length,0);
  await Promise.all(f.player.audioInflight.values());const updated=f.player.row(row.id);assert.equal(updated.state,'queued');assert.equal(updated.asset.url,row.asset.url);assert.equal(updated.asset.sha256,row.asset.sha256);assert.equal(updated.asset.tracking.sha256,row.asset.tracking.sha256);assert.equal(updated.asset.playback.audio,true);assert.match(updated.asset.playback.url,/\.audio\.webm$/);assert.equal(updated.asset.playback.sourceAudioSha256,sha('original-aac'));
  const scene=JSON.parse(fs.readFileSync(path.join(f.root,updated.playback.sceneUrl.slice(1))));assert.equal(scene.overlayVideoUrl,updated.asset.playback.url);
  const second=f.add('audio-two');assert.equal(f.player.enqueue(second.id).queued,true);assert.equal(calls(),1);assert.equal(f.player.row(second.id).asset.playback.url,updated.asset.playback.url);
  f.write(updated.asset.playback.url,'tampered');f.player.tick();assert.equal(f.outputs.length,0);assert.equal(f.player.row(row.id).playback.reason,'interaction_audio_snapshot_changed');
});
test('source duration mismatch and lost output alpha fall back honestly without derivative or retry loop',async t=>{
  for(const options of [{badDuration:true},{badAlpha:true}]){const f=fixture(t),calls=enableAudio(f,options),row=f.add('audio');assert.equal(f.player.enqueue(row.id).state,'preparing_audio');await Promise.all(f.player.audioInflight.values());const updated=f.player.row(row.id);assert.equal(updated.state,'queued');assert.equal(updated.asset.playback,undefined);assert.equal(updated.asset.audioStatus.state,'unavailable');assert.equal(updated.asset.url,row.asset.url);assert.equal(calls(),options.badDuration?0:1);assert.equal(f.player.audioInflight.size,0);}
});
test('source modification during mux is rejected before output can be queued with that audio',async t=>{
  const f=fixture(t),calls=enableAudio(f,{changeSource:true}),row=f.add('audio');f.player.enqueue(row.id);
  const first=f.player.audioInflight.get(row.id);await first;
  assert.equal(f.player.row(row.id).asset.playback,undefined);assert.equal(f.player.row(row.id).state,'queued');assert.equal(f.player.row(row.id).asset.audioStatus.reason,'interaction_audio_source_changed');assert.equal(f.player.audioInflight.size,0);assert.equal(calls(),1);
});
function setDetection(f,row,missing){
 const raw=JSON.parse(fs.readFileSync(path.join(f.root,row.asset.tracking.url.slice(1))));raw.detected=raw.detected.map((_,i)=>!missing.includes(i));const bytes=JSON.stringify(raw);f.write(row.asset.tracking.url,bytes);row.asset.tracking={...row.asset.tracking,detected:raw.detected,sha256:sha(bytes)};f.interactions.save(f.interactions.requests.map(r=>r.id===row.id?row:r));return raw;
}
test('trusted bounded-occlusion policy preserves false flags; long and edge gaps remain awaiting review',t=>{
 const f=fixture(t);f.template.profile.maxUnobservedGapFrames=2;f.saveTemplate();const short=f.add('short');setDetection(f,short,[50,51]);const result=f.player.enqueue(short.id);assert.equal(result.queued,true);assert.deepEqual(result.trackingQuality,{shortGapsHeld:2,shortGapRuns:1,maxUnobservedGapFrames:2});assert.equal(f.player.row(short.id).asset.tracking.detected[50],false);
 const long=f.add('long',{video:'different'});setDetection(f,long,[50,51,52]);assert.equal(f.player.enqueue(long.id).state,'awaiting_review');const edge=f.add('edge',{video:'another'});setDetection(f,edge,[0]);assert.equal(f.player.enqueue(edge.id).state,'awaiting_review');
});
test('one local recovery handles concurrent identical faces then queues using actual observed detections and bounded gap',async t=>{
 const f=fixture(t);f.template.profile.maxUnobservedGapFrames=2;f.saveTemplate();f.write('/tools/chino_anchor.py','helper-v2');f.write('/media/overlays/face.webm','same-video');f.interactions.probe=async()=>({format:{duration:4.042},streams:[{codec_type:'video',width:400,height:736,tags:{alpha_mode:'1'}}]});
 const one=f.add('track-one'),raw=setDetection(f,one,Array.from({length:10},(_,i)=>63+i));let calls=0;f.player.retrack=async({output,basename})=>{calls++;assert.equal(basename,'face');fs.writeFileSync(output,JSON.stringify({...raw,detected:raw.detected.map((_,i)=>i!==79)}));};
 assert.equal(f.player.enqueue(one.id).state,'preparing_tracking');const two=f.add('track-two');setDetection(f,two,Array.from({length:10},(_,i)=>63+i));assert.equal(f.player.enqueue(two.id).state,'preparing_tracking');await Promise.all(f.player.trackingInflight.values());
 assert.equal(calls,1);for(const id of [one.id,two.id]){assert.equal(f.player.row(id).state,'queued');assert.equal(f.player.row(id).asset.tracking.detected[79],false);assert.equal(f.player.row(id).asset.trackingQuality.shortGapsHeld,1);}
});
test('failed local recovery is attempted once per asset/helper version and never trusts a changing source',async t=>{
 const f=fixture(t);f.write('/tools/chino_anchor.py','helper-v1');f.write('/media/overlays/face.webm','same-video');const row=f.add('bad'),raw=setDetection(f,row,[50,51,52]);let calls=0;f.player.retrack=async()=>{calls++;throw new Error('interaction_local_tracking_failed');};
 f.player.enqueue(row.id);await Promise.all(f.player.trackingInflight.values());assert.equal(f.player.row(row.id).state,'awaiting_review');f.player.enqueue(row.id);assert.equal(calls,1);assert.equal(f.player.trackingInflight.size,0);
 f.write('/tools/chino_anchor.py','helper-v2');f.player.retrack=async({output})=>{calls++;fs.writeFileSync(output,JSON.stringify({...raw,detected:raw.detected.map(()=>true)}));f.write('/media/overlays/face.webm','new-face');};f.player.enqueue(row.id);await Promise.all(f.player.trackingInflight.values());assert.equal(calls,2);assert.equal(f.player.row(row.id).state,'awaiting_review');assert.equal(f.player.row(row.id).playback.reason,'interaction_track_asset_changed');assert.equal(f.player.row(row.id).asset.tracking.detected[50],false);
});

test('clearPending preserves active effect and history, cancels waiting work and never replays a cancelled request',t=>{
 const f=fixture(t),one=f.add('active'),two=f.add('queued'),three=f.add('review',{badFlags:true,video:'other'});f.player.enqueue(one.id);f.player.tick();f.player.enqueue(two.id);f.player.enqueue(three.id);
 const result=f.player.clearPending();assert.equal(result.cleared,2);assert.equal(result.activePreserved,true);assert.equal(f.player.row(one.id).state,'queued');assert.equal(f.player.row(two.id).state,'cancelled');assert.equal(f.player.row(three.id).state,'cancelled');assert.equal(f.interactions.status().cancelled,2);
 assert.equal(f.player.enqueue(two.id).state,'cancelled');assert.equal(f.player.clearPending().cleared,0);assert.ok(fs.existsSync(path.join(f.root,two.asset.url.slice(1))));
 const message=f.outputs.at(-1);f.d.playback({stageId:'owner-stage',playId:message.playId,state:'started',duration:14.042667});f.d.playback({stageId:'owner-stage',playId:message.playId,state:'ended'});f.player.tick();assert.equal(f.outputs.length,1);assert.equal(f.player.row(one.id).state,'completed');
});
test('clearing while audio restoration is in flight cannot resurrect the request',async t=>{
 const f=fixture(t);enableAudio(f);let release;const gate=new Promise(resolve=>release=resolve);f.player.convertAudio=async({output})=>{await gate;fs.writeFileSync(output,'audio');};const row=f.add('audio-cancel');f.player.enqueue(row.id);const pending=f.player.audioInflight.get(row.id);assert.equal(f.player.clearPending().cleared,1);release();await pending;assert.equal(f.player.row(row.id).state,'cancelled');f.player.tick();assert.equal(f.outputs.length,0);
});
test('clearing during tracking attachment probe cannot restore a stale queued state',async t=>{
 const f=fixture(t),row=f.add('tracking-cancel');f.write('/media/overlays/face.webm','same-video');const raw=setDetection(f,row,[50,51,52]);f.write('/media/overlays/revised.grab.json',JSON.stringify({...raw,detected:raw.detected.map(()=>true)}));let release;const gate=new Promise(resolve=>release=resolve);f.interactions.probe=async()=>{await gate;return {format:{duration:4.042},streams:[{codec_type:'video',width:400,height:736,tags:{alpha_mode:'1'}}]};};
 const attaching=f.interactions.attachTracking({id:row.id,trackUrl:'/media/overlays/revised.grab.json'});f.player.clearPending();release();await attaching;assert.equal(f.player.row(row.id).state,'cancelled');assert.equal(f.player.enqueue(row.id).state,'cancelled');assert.equal(f.outputs.length,0);
});

test('a fresh request can recover after the prior attempt for that asset was cancelled',async t=>{
 const f=fixture(t);f.template.profile.maxUnobservedGapFrames=2;f.saveTemplate();f.write('/tools/chino_anchor.py','helper-cancel');f.write('/media/overlays/face.webm','same-video');f.interactions.probe=async()=>({format:{duration:4.042},streams:[{codec_type:'video',width:400,height:736,tags:{alpha_mode:'1'}}]});
 const original=f.add('cancelled-recovery'),raw=setDetection(f,original,[50,51,52]);let release,calls=0;const gate=new Promise(resolve=>release=resolve);f.player.retrack=async({output})=>{calls++;if(calls===1)await gate;fs.writeFileSync(output,JSON.stringify({...raw,detected:raw.detected.map(()=>true)}));};
 assert.equal(f.player.enqueue(original.id).state,'preparing_tracking');const first=f.player.trackingInflight.values().next().value;assert.equal(f.player.clearPending().cleared,1);release();await first;assert.equal(f.player.row(original.id).state,'cancelled');
 const next=f.add('fresh-recovery');setDetection(f,next,[50,51,52]);assert.equal(f.player.enqueue(next.id).state,'preparing_tracking');await Promise.all(f.player.trackingInflight.values());assert.equal(calls,2);assert.equal(f.player.row(next.id).state,'queued');assert.equal(f.player.row(original.id).state,'cancelled');
});

test('fresh click joining a cancelled in-flight recovery starts its own attempt after the old job settles',async t=>{
 const f=fixture(t);f.template.profile.maxUnobservedGapFrames=2;f.saveTemplate();f.write('/tools/chino_anchor.py','helper-cancel-join');f.write('/media/overlays/face.webm','same-video');f.interactions.probe=async()=>({format:{duration:4.042},streams:[{codec_type:'video',width:400,height:736,tags:{alpha_mode:'1'}}]});
 const original=f.add('cancelled-joined'),raw=setDetection(f,original,[50,51,52]);let release,calls=0;const gate=new Promise(resolve=>release=resolve);f.player.retrack=async({output})=>{calls++;if(calls===1)await gate;fs.writeFileSync(output,JSON.stringify({...raw,detected:raw.detected.map(()=>true)}));};
 f.player.enqueue(original.id);const first=f.player.trackingInflight.values().next().value;f.player.clearPending();const next=f.add('fresh-joined');setDetection(f,next,[50,51,52]);assert.equal(f.player.enqueue(next.id).state,'preparing_tracking');assert.equal(f.player.row(next.id).asset.trackingRecovery.state,'waiting');release();await first;await Promise.all(f.player.trackingInflight.values());assert.equal(calls,2);assert.equal(f.player.row(next.id).state,'queued');assert.equal(f.player.row(original.id).state,'cancelled');
});

test('side dance gates approval, needs no hand track, uses exact lion duration and immutable dance asset',t=>{
 const f=fixture(t),base='/media/dance/lion_vibe1.mp4',hash=f.write(base,'dance');const template={version:1,preset:'dancer_side_dance',enabled:false,approvalScope:'pending_operator_review',approvedForIntegratedOutput:false,publicApproved:false,baseVideoUrl:base,baseVideoSha256:hash,profile:{version:1,kind:'side_dance',reviewed:true,sourceFile:'lion_vibe1.mp4',duration:10,place:{x:.2,y:.78,width:.42},fadeIn:.4,fadeOut:.6}};
 const save=()=>f.write('/media/interactions/templates/dancer_side_dance.json',JSON.stringify(template));save();const row=f.add('side',{preset:'dancer_side_dance'});delete row.asset.tracking;f.interactions.save([row]);assert.equal(f.player.enqueue(row.id).state,'awaiting_lion_motion');assert.equal(f.player.row(row.id).playback.reason,'interaction_motion_not_approved');
 Object.assign(template,{enabled:true,approvalScope:'operator_approved_output',approvedForIntegratedOutput:true});save();assert.equal(f.player.enqueue(row.id).state,'queued');assert.equal(f.player.row(row.id).playback.expectedDuration,10);const scene=JSON.parse(fs.readFileSync(path.join(f.root,f.player.row(row.id).playback.sceneUrl.slice(1))));assert.equal(scene.sourceTrackUrl,undefined);assert.equal(scene.sourceMetadata.width,400);assert.equal(scene.profile.kind,'side_dance');f.write(base,'changed');assert.throws(()=>f.player.prepare(f.player.row(row.id)),/interaction_motion_changed/);
});

test('chicken blow remains gated until approved and creates a six-second anchor-free scene',t=>{const f=fixture(t),base='/media/generated/lion_blow.mp4',hash=f.write(base,'blow');const template={version:1,preset:'chicken_blow',enabled:false,approvalScope:'pending_operator_review',approvedForIntegratedOutput:false,baseVideoUrl:base,baseVideoSha256:hash,profile:{version:1,kind:'chicken_blow',reviewed:true,sourceFile:'lion_blow.mp4',duration:6,blowAt:2.8,exitAt:3.8,enterFrom:.4,standAt:2,groundY:.65,standX:.22,width:.28}};const save=()=>f.write('/media/interactions/templates/chicken_blow.json',JSON.stringify(template));save();const row=f.add('blow',{preset:'chicken_blow'});delete row.asset.tracking;f.interactions.save([row]);assert.equal(f.player.enqueue(row.id).state,'awaiting_lion_motion');assert.equal(f.player.row(row.id).playback.reason,'interaction_motion_not_approved');assert.ok(!f.interactions.status().supportedPresets.includes('chicken_blow'));Object.assign(template,{enabled:true,approvalScope:'operator_approved_output',approvedForIntegratedOutput:true});save();assert.ok(f.interactions.status().supportedPresets.includes('chicken_blow'));assert.equal(f.player.enqueue(row.id).state,'queued');const scene=JSON.parse(fs.readFileSync(path.join(f.root,f.player.row(row.id).playback.sceneUrl.slice(1))));assert.equal(scene.profile.blowAt,2.8);assert.equal(scene.sourceTrackUrl,undefined);assert.equal(f.player.row(row.id).playback.expectedDuration,6);assert.deepEqual(scene.trackingQuality,{trackingRequired:false});f.write(base,'changed');assert.throws(()=>f.player.prepare(f.player.row(row.id)),/interaction_motion_changed/);});


test('baby feeding uses feed tracks, preserves review gating and rejects unobserved mouth tracking',t=>{
 const f=fixture(t);const template={...f.template,preset:'baby_bottle_feed',enabled:false};
 const save=()=>f.write('/media/interactions/templates/baby_bottle_feed.json',JSON.stringify(template));save();
 let row=f.add('baby',{preset:'baby_bottle_feed'});
 const raw={...row.asset.tracking,feedPoint:{x:.5,y:.15}};delete raw.url;delete raw.sha256;
 const trackUrl='/media/interactions/incoming/baby.feed.json',trackSha=f.write(trackUrl,JSON.stringify(raw));
 row={...row,asset:{...row.asset,feedPoint:{x:.5,y:.15},tracking:{...raw,url:trackUrl,sha256:trackSha}}};f.interactions.save([row]);
 assert.throws(()=>f.player.prepare(row),/interaction_motion_not_approved/);
 template.enabled=true;save();const prepared=f.player.prepare(row);assert.equal(prepared.profile.repeatCount,2);assert.ok(prepared.expectedDuration>0);
 const wrong={...raw,detected:raw.detected.map((v,i)=>i===20?false:v)};const wrongSha=f.write(trackUrl,JSON.stringify(wrong));
 row={...row,asset:{...row.asset,tracking:{...wrong,url:trackUrl,sha256:wrongSha}}};
 assert.throws(()=>f.player.prepare(row),/interaction_tracking_review_required/);
});

test('tiny on paw prepares two source passes from internal foot placement without sender tracking',t=>{
 const f=fixture(t),row=f.add('tiny',{preset:'tiny_on_paw'});delete row.asset.tracking;row.asset.placement={version:1,width:400,height:736,fps:24,frames:97,sourceSha256:row.asset.sha256,method:'observed_alpha_feet',track:Array.from({length:97},(_,i)=>[i/24,.5,.98]),detected:Array(97).fill(true)};f.interactions.save([row]);
 const template={...f.template,preset:'tiny_on_paw'};f.write('/media/interactions/templates/tiny_on_paw.json',JSON.stringify(template));const p=f.player.prepare(row);assert.equal(p.profile.repeatCount,2);assert.equal(p.trackingQuality.placementMethod,'observed_alpha_feet');
 row.asset.placement.sourceSha256='a'.repeat(64);assert.throws(()=>f.player.prepare(row),/interaction_foot_placement_required/);
});
