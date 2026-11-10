import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ChinoInteractions} from './chino-interactions.mjs';
const alpha={streams:[{codec_type:'video',width:720,height:1280,tags:{alpha_mode:'1'}}]};
function setup(t,probe=async()=>alpha){const root=fs.mkdtempSync(path.join(os.tmpdir(),'chino-interaction-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'media','overlays'),{recursive:true});fs.mkdirSync(path.join(root,'media','interactions','incoming'),{recursive:true});fs.writeFileSync(path.join(root,'media','overlays','chicken.webm'),'fixture');const events=[];const intake=new ChinoInteractions({root,probe,emit:(type,data)=>events.push({type,...data})});const input={requestId:'request-one',preset:'chicken_comb_hold',asset:{url:'/media/overlays/chicken.webm',grabPoint:{x:.5,y:.08}},participant:{id:'viewer-123'}};return {root,intake,input,events};}
test('one alpha asset is persisted awaiting real lion motion, without render or generation',async t=>{const s=setup(t);const result=await s.intake.receive(s.input);assert.equal(result.accepted,true);assert.equal(result.state,'awaiting_lion_motion');assert.equal(result.rendered,false);assert.equal(result.generationSubmitted,false);assert.equal(s.events.length,1);assert.equal(s.events[0].type,'interaction-received');const reopened=new ChinoInteractions({root:s.root});assert.equal(reopened.status().requests[0].id,result.id);assert.equal(reopened.status().pending,1);});
test('local 7777 URL and its shared-project relative path are the same idempotent asset',async t=>{let calls=0;const s=setup(t,async()=>{calls++;return alpha;});const a=await s.intake.receive(s.input),b=await s.intake.receive({...s.input,asset:{url:'http://127.0.0.1:7777/media/overlays/chicken.webm',grabPoint:{x:.5,y:.08}}});assert.equal(a.id,b.id);assert.equal(b.idempotent,true);assert.equal(calls,1);assert.equal(s.events.length,1);});
test('conflicting reuse of requestId is rejected',async t=>{const s=setup(t);await s.intake.receive(s.input);await assert.rejects(s.intake.receive({...s.input,participant:{id:'different'}}),/interaction_request_conflict/);assert.equal(s.intake.status().requests.length,1);});
test('foreign URLs, file paths, traversal and unapproved folders never reach probe',async t=>{let calls=0;const s=setup(t,async()=>{calls++;return alpha;});for(const url of ['https://example.com/chicken.webm','http://127.0.0.1:7780/media/overlays/chicken.webm','file:///C:/chicken.webm','/media/overlays/../private.webm','/media/overlays/%2e%2e%2fprivate.webm','/media/idle/chicken.webm','//example.com/chicken.webm','/media/overlays/chicken.webm?token=secret'])await assert.rejects(s.intake.receive({...s.input,asset:{url}}),/interaction_asset|invalid_interaction_asset/);assert.equal(calls,0);});
test('missing file and non-alpha video have explicit failures and no stored request',async t=>{const s=setup(t,async()=>({streams:[{codec_type:'video',width:720,height:1280,tags:{}}]}));await assert.rejects(s.intake.receive({...s.input,asset:{url:'/media/overlays/missing.webm'}}),/interaction_asset_missing/);await assert.rejects(s.intake.receive(s.input),/interaction_asset_alpha_required/);assert.equal(s.intake.status().pending,0);});
test('incoming shared-project folder is accepted and malformed video dimensions are rejected',async t=>{const s=setup(t);fs.writeFileSync(path.join(s.root,'media','interactions','incoming','one.webm'),'fixture');assert.equal((await s.intake.receive({...s.input,asset:{url:'/media/interactions/incoming/one.webm'}})).accepted,true);const bad=new ChinoInteractions({root:s.root,probe:async()=>({streams:[{codec_type:'video',width:0,height:1280,tags:{alpha_mode:'1'}}]})});await assert.rejects(bad.receive({...s.input,requestId:'bad-video'}),/interaction_asset_invalid_video/);});
test('concurrent identical deliveries perform one probe and produce one receipt',async t=>{let release,calls=0;const s=setup(t,()=>{calls++;return new Promise(r=>release=r);});const a=s.intake.receive(s.input),b=s.intake.receive(s.input);release(alpha);const results=await Promise.all([a,b]);assert.equal(calls,1);assert.equal(results[0].id,results[1].id);assert.equal(s.events.length,1);});
test('unknown preset and participant are rejected before an intake is stored',async t=>{const s=setup(t);await assert.rejects(s.intake.receive({...s.input,preset:'run_anything'}),/unsupported_interaction_preset/);await assert.rejects(s.intake.receive({...s.input,participant:{id:''}}),/invalid_interaction_participant/);assert.equal(s.intake.status().pending,0);});
test('different faces replacing the same source filename get different immutable copies and digests',async t=>{const s=setup(t);const first=await s.intake.receive(s.input);fs.writeFileSync(path.join(s.root,'media','overlays','chicken.webm'),'second-participant-face');const second=await s.intake.receive({...s.input,requestId:'request-two',participant:{id:'viewer-456'}});const rows=s.intake.status().requests;assert.notEqual(first.id,second.id);assert.notEqual(rows[0].asset.url,rows[1].asset.url);assert.notEqual(rows[0].asset.sha256,rows[1].asset.sha256);assert.equal(fs.readFileSync(path.join(s.root,rows[0].asset.url.slice(1)),'utf8'),'fixture');assert.equal(fs.readFileSync(path.join(s.root,rows[1].asset.url.slice(1)),'utf8'),'second-participant-face');assert.equal(rows[1].participant.id,'viewer-456');assert.equal((await s.intake.receive(s.input)).id,first.id);assert.equal(s.intake.status().requests.length,2);});
test('a source file still changing during validation is rejected and its partial snapshot removed',async t=>{let source;const s=setup(t,async()=>{fs.appendFileSync(source,'still-writing');return alpha;});source=path.join(s.root,'media','overlays','chicken.webm');await assert.rejects(s.intake.receive(s.input),/interaction_asset_changed/);assert.equal(s.intake.status().requests.length,0);assert.equal(fs.readdirSync(path.join(s.root,'media','interactions','incoming')).length,0);});
test('missing comb grab point stays in needs_anchor and invalid normalized points are rejected',async t=>{const s=setup(t);const result=await s.intake.receive({...s.input,asset:{url:s.input.asset.url}});assert.equal(result.state,'needs_anchor');assert.equal(result.rendered,false);assert.equal(result.needsAnchor,true);await assert.rejects(s.intake.receive({...s.input,requestId:'bad-point',asset:{url:s.input.asset.url,grabPoint:{x:1.2,y:0}}}),/invalid_interaction_grab_point/);});


const alphaTimed={streams:[{codec_type:'video',width:720,height:1280,tags:{alpha_mode:'1'}}],format:{duration:'4.0'}};
function trackFixture(s,{suffix='grab',changes={}}={}){
 const data={version:1,file:'chicken.webm',width:720,height:1280,fps:24,frames:4,track:[[0,.5,.1],[1,.51,.2],[2,.52,.56],[3,.5,.04]],detected:[true,false,true,true],stableWindow:{from:0,to:1},...changes};
 const url='/media/overlays/chicken.'+suffix+'.json';fs.writeFileSync(path.join(s.root,url.slice(1)),JSON.stringify(data));return {url,data};
}
test('baby bottle preset accepts its own feedPoint and immutable moving mouth track',async t=>{
 const s=setup(t,async()=>alphaTimed),f=trackFixture(s,{suffix:'feed'});
 const input={...s.input,preset:'baby_bottle_feed',asset:{url:s.input.asset.url,feedPoint:{x:.515,y:.355},trackUrl:f.url}};
 const result=await s.intake.receive(input),row=s.intake.status().requests[0];
 assert.equal(result.state,'awaiting_lion_motion');assert.equal(result.hasTracking,true);assert.deepEqual(row.asset.feedPoint,input.asset.feedPoint);assert.equal(row.asset.grabPoint,undefined);
 assert.equal(row.asset.durationSeconds,4);assert.deepEqual(row.asset.tracking.track,f.data.track);assert.deepEqual(row.asset.tracking.detected,f.data.detected);assert.equal(row.asset.tracking.pointKind,'feedPoint');
 assert.equal(row.rendered,false);assert.equal(row.generationSubmitted,false);assert.ok(fs.existsSync(path.join(s.root,row.asset.tracking.url.slice(1))));
});
test('safe auto-discovery snapshots matching source sidecar without changing legacy chicken fingerprint',async t=>{
 const s=setup(t,async()=>alphaTimed);trackFixture(s);const result=await s.intake.receive(s.input),row=s.intake.status().requests[0];
 const legacy=JSON.stringify({requestId:s.input.requestId,preset:'chicken_comb_hold',assetUrl:s.input.asset.url,participantId:s.input.participant.id,grabPoint:s.input.asset.grabPoint});
 assert.equal(row.fingerprint,legacy);assert.equal(result.hasTracking,true);assert.equal((await s.intake.receive(s.input)).idempotent,true);
 assert.deepEqual(row.asset.tracking.detected,[true,false,true,true]);assert.equal(row.asset.tracking.stableWindow.to,1);
});
test('existing chicken can gain tracking by id or requestId without changing receipt or fingerprint',async t=>{
 const s=setup(t,async()=>alphaTimed);const accepted=await s.intake.receive(s.input),original=s.intake.status().requests[0],f=trackFixture(s);
 const result=await s.intake.attachTracking({id:accepted.id,trackUrl:f.url});assert.equal(result.id,accepted.id);assert.equal(result.trackingAttached,true);
 const row=s.intake.status().requests[0];assert.equal(row.fingerprint,original.fingerprint);assert.equal(row.asset.sha256,original.asset.sha256);
 const again=await s.intake.attachTracking({id:s.input.requestId,trackUrl:'http://127.0.0.1:7777'+f.url});assert.equal(again.idempotent,true);
 assert.equal(s.intake.status().requests.length,1);assert.equal((await s.intake.receive(s.input)).id,accepted.id);
 assert.equal(s.events.filter(e=>e.type==='interaction-tracking-updated').length,1);
});
test('legacy request without duration is probed before tracking is attached',async t=>{
 const s=setup(t,async()=>alphaTimed);const r=await s.intake.receive(s.input),f=trackFixture(s),saved=JSON.parse(fs.readFileSync(s.intake.file,'utf8'));delete saved.requests[0].asset.durationSeconds;fs.writeFileSync(s.intake.file,JSON.stringify(saved));
 let probes=0;const reopened=new ChinoInteractions({root:s.root,probe:async()=>{probes++;return alphaTimed;}});
 await reopened.attachTracking({id:r.id,trackUrl:f.url});assert.equal(probes,1);assert.equal(reopened.status().requests[0].asset.durationSeconds,4);
});
test('Opus-padded container duration never extends video tracking; explicit attach repairs finite legacy duration',async t=>{
 const padded={streams:[{codec_type:'video',width:720,height:1280,tags:{alpha_mode:'1',DURATION:'00:00:04.041000000'}},{codec_type:'audio',codec_name:'opus'}],format:{duration:'4.049'}};
 const s=setup(t,async()=>padded),f=trackFixture(s,{changes:{fps:24,frames:97,track:Array.from({length:97},(_,i)=>[i/24,.5,.1]),detected:Array(97).fill(true)}});
 const accepted=await s.intake.receive(s.input);assert.equal(s.intake.requests[0].asset.durationSeconds,4.041);
 s.intake.requests[0].asset.durationSeconds=4.049;s.intake.save(s.intake.requests);const fingerprint=s.intake.requests[0].fingerprint,trackSha=s.intake.requests[0].asset.tracking.sha256;
 const attached=await s.intake.attachTracking({id:accepted.id,trackUrl:f.url});assert.equal(attached.idempotent,true);assert.equal(s.intake.requests[0].asset.durationSeconds,4.041);assert.equal(s.intake.requests[0].asset.tracking.sha256,trackSha);assert.equal(s.intake.requests[0].fingerprint,fingerprint);
 assert.equal(s.intake.requests[0].asset.tracking.track.at(-1)[0]+1/24+.002>=s.intake.requests[0].asset.durationSeconds,true);
 const reopened=new ChinoInteractions({root:s.root});assert.equal(reopened.requests[0].asset.durationSeconds,4.041);
});
test('track snapshots remain bound to their face version when the source filename is reused',async t=>{
 const s=setup(t,async()=>alphaTimed),f=trackFixture(s);await s.intake.receive(s.input);const first=s.intake.status().requests[0];
 fs.writeFileSync(path.join(s.root,s.input.asset.url.slice(1)),'new-face');trackFixture(s,{changes:{track:[[0,.2,.1],[1,.3,.2],[2,.3,.4],[3,.2,.1]]}});
 await s.intake.receive({...s.input,requestId:'other-face',participant:{id:'viewer-other'}});const second=s.intake.status().requests[1];
 assert.notEqual(first.asset.sha256,second.asset.sha256);assert.notEqual(first.asset.tracking.sha256,second.asset.tracking.sha256);assert.notEqual(first.asset.tracking.url,second.asset.tracking.url);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.root,first.asset.tracking.url.slice(1)),'utf8')).track,f.data.track);
 await assert.rejects(s.intake.attachTracking({id:first.id,trackUrl:f.url}),/interaction_track_asset_changed/);
});
test('malformed, wrong-source, out-of-bounds and nonmonotonic tracks never create a receipt',async t=>{
 const invalid=[{version:2},{file:'another-face.webm'},{width:400},{fps:0},{frames:3},{track:[[0,.5,.1],[0,.4,.2]],frames:2,detected:[true,true]},{track:[[0,1.1,.1]],frames:1,detected:[true]},{track:[[5,.5,.1]],frames:1,detected:[true]},{detected:[true]},{detected:[true,'unknown',false,true]},{stableWindow:{from:1,to:.5}},{stableWindow:{from:0,to:4.5}}];
 for(const [i,changes] of invalid.entries()){
  const s=setup(t,async()=>alphaTimed),f=trackFixture(s,{changes});
  await assert.rejects(s.intake.receive({...s.input,requestId:'bad-'+i,asset:{...s.input.asset,trackUrl:f.url}}),/interaction_track|invalid_interaction/);
  assert.equal(s.intake.status().requests.length,0);assert.equal(fs.readdirSync(path.join(s.root,'media','interactions','incoming')).length,0);
 }
});
test('oversize track and mismatched grab/feed sidecars are rejected before being stored',async t=>{
 const s=setup(t,async()=>alphaTimed),f=trackFixture(s);fs.writeFileSync(path.join(s.root,f.url.slice(1)),' '.repeat(1024*1024+1));
 await assert.rejects(s.intake.receive({...s.input,asset:{...s.input.asset,trackUrl:f.url}}),/interaction_track_too_large/);
 const feed=trackFixture(s,{suffix:'feed'});await assert.rejects(s.intake.receive({...s.input,asset:{...s.input.asset,trackUrl:feed.url}}),/interaction_track_preset_mismatch/);
});
test('a tracking correction creates a new immutable revision, preserving the original evidence',async t=>{
 const s=setup(t,async()=>alphaTimed),f=trackFixture(s);const accepted=await s.intake.receive(s.input),before=s.intake.status().requests[0].asset.tracking;
 trackFixture(s,{changes:{track:[[0,.1,.1],[1,.2,.2],[2,.3,.3],[3,.4,.4]]}});await s.intake.attachTracking({id:accepted.id,trackUrl:f.url});
 const after=s.intake.status().requests[0].asset;assert.notEqual(after.tracking.url,before.url);assert.equal(after.trackingRevisions[0].sha256,before.sha256);assert.ok(fs.existsSync(path.join(s.root,before.url.slice(1))));
});
test('optional detection metadata is preserved as unknown rather than inventing detections',async t=>{
 const s=setup(t,async()=>alphaTimed),f=trackFixture(s,{changes:{detected:undefined,stableWindow:undefined}});await s.intake.receive(s.input);const row=s.intake.status().requests[0];
 assert.equal(row.asset.tracking.detected,null);assert.equal(row.asset.tracking.stableWindow,null);
 const result=await s.intake.attachTracking({id:row.id,trackUrl:row.asset.tracking.url});assert.equal(result.idempotent,true);
});
test('feed points and tracking paths preserve normalized-value and local-file boundaries',async t=>{
 const s=setup(t,async()=>alphaTimed);for(const point of [{x:-.1,y:0},{x:.5,y:2},{x:'0.5',y:.2},null])await assert.rejects(s.intake.receive({...s.input,preset:'baby_bottle_feed',asset:{url:s.input.asset.url,feedPoint:point}}),/invalid_interaction_feed_point/);
 for(const trackUrl of ['https://evil.test/chicken.grab.json','/media/overlays/../private.grab.json','/media/overlays/secret.json','file:///C:/private.grab.json'])await assert.rejects(s.intake.receive({...s.input,asset:{...s.input.asset,trackUrl}}),/interaction_asset|invalid_interaction_asset/);
});

test('side dancer intake accepts alpha without anchors or tracking and remains awaiting motion',async t=>{const s=setup(t,async()=>alphaTimed);const result=await s.intake.receive({...s.input,preset:'dancer_side_dance',asset:{url:s.input.asset.url}});assert.equal(result.state,'awaiting_lion_motion');assert.equal(result.needsAnchor,false);assert.equal(result.hasTracking,false);assert.ok(s.intake.status().supportedPresets.includes('dancer_side_dance'));assert.equal(s.intake.requests[0].asset.null,undefined);await assert.rejects(s.intake.receive({...s.input,requestId:'unneeded-track',preset:'dancer_side_dance',asset:{url:s.input.asset.url,trackUrl:'/media/overlays/chicken.hand.json'}}),/interaction_tracking_not_used/);});

test('chicken blow accepts anchor-free alpha but stays undiscoverable until enabled and approved',async t=>{const s=setup(t,async()=>alphaTimed);const result=await s.intake.receive({...s.input,preset:'chicken_blow',asset:{url:s.input.asset.url}});assert.equal(result.needsAnchor,false);assert.equal(result.hasTracking,false);assert.equal(result.state,'awaiting_lion_motion');assert.ok(!s.intake.status().supportedPresets.includes('chicken_blow'));const dir=path.join(s.root,'media/interactions/templates');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'chicken_blow.json');fs.writeFileSync(file,JSON.stringify({enabled:false,approvedForIntegratedOutput:false}));assert.ok(!s.intake.status().supportedPresets.includes('chicken_blow'));fs.writeFileSync(file,JSON.stringify({enabled:true,approvedForIntegratedOutput:true,approvalScope:'operator_approved_output'}));assert.ok(s.intake.status().supportedPresets.includes('chicken_blow'));});


test('tiny on paw observes source feet internally and advertises only after visual approval',async t=>{
 const s=setup(t,async()=>({streams:[{codec_type:'video',width:20,height:20,avg_frame_rate:'24/1',duration:'1',tags:{alpha_mode:'1'}}]}));let calls=0;
 s.intake.placeFeet=async()=>{calls++;return {version:1,width:20,height:20,fps:24,frames:24,method:'observed_alpha_feet',track:Array.from({length:24},(_,i)=>[i/24,.5,.95]),detected:Array(24).fill(true)};};
 const input={...s.input,preset:'tiny_on_paw',asset:{url:s.input.asset.url}};
 assert.ok(!s.intake.status().supportedPresets.includes('tiny_on_paw'));
 const receipt=await s.intake.receive(input),row=s.intake.requests[0];assert.equal(receipt.accepted,true);assert.equal(row.asset.placement.sourceSha256,row.asset.sha256);assert.equal(row.asset.tracking,undefined);assert.equal(calls,1);
 await s.intake.receive(input);assert.equal(calls,1);
 await assert.rejects(s.intake.receive({...input,requestId:'tiny-invalid-track',asset:{...input.asset,trackUrl:'/media/overlays/a.hand.json'}}),/interaction_tracking_not_used/);
 const folder=path.join(s.root,'media/interactions/templates');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,'tiny_on_paw.json');fs.writeFileSync(file,JSON.stringify({enabled:true,approvedForIntegratedOutput:true,approvalScope:'operator_approved_output'}));assert.ok(s.intake.status().supportedPresets.includes('tiny_on_paw'));
});
