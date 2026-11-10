import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {VideoDirector} from './video-director.mjs';
import {VideoProduction} from './video-production.mjs';
import {createVideoDirector} from './video-director-server.mjs';
function setup(extra={}){
 const d=new VideoDirector({catalog:()=>[],context:()=>({}),providerStatus:()=>({configured:true}),output:()=>{},...extra});d.setRoom('room');
 const p=new VideoProduction({director:d,now:()=>1000});p.authorizeLive({approved:true,budgetUSD:10,room:'room'});p.enableLive('room');
 const offer=(i,over={})=>{const e={id:'e'+i,type:'opponent',text:'שאלה '+i,room:'room',source:'isolated_audio',t:1001,language:'he',...over};const decision={text:'תשובה מספר '+i,confidence:1,action:'draft',bankReview:{provider:'openai',eventId:e.id,passes:2,noMatchConfirmed:true,libraryRevision:d.bankRevision(e),at:1000}};const row=d.missing(e,decision);return p.offerLive(row,e,decision);};
 return {d,p,offer};
}

test('automatic production requires a completed second GPT review for this exact event',()=>{
 const {d,p}=setup();const event={id:'review-event',type:'chat',text:'צינו שאלה',room:'room',uid:'viewer',source:'tiktools',t:1001,language:'he'};
 const decision={action:'draft',text:'תשובה חדשה',confidence:1};const row=d.missing(event,decision);
 for(const bankReview of [undefined,{provider:'openai',eventId:event.id,passes:1,noMatchConfirmed:true},{provider:'openai',eventId:'different',passes:2,noMatchConfirmed:true},{provider:'openai',eventId:event.id,passes:2,noMatchConfirmed:false}])assert.equal(p.offerLive(row,event,{...decision,bankReview}).reason,'gpt_bank_review_required');
 assert.equal(p.data.autoSession.reservedUSD,0);assert.equal(p.data.autoQueue.length,0);
});
test('live reservations enforce ten dollar total across toggles and restart',()=>{
 const {d,p,offer}=setup();for(let i=0;i<8;i++)assert.equal(offer(i).queued,true);assert.equal(offer(9).reason,'live_budget_exhausted');assert.equal(p.data.autoSession.reservedUSD,9.2);
 p.pauseLive();p.enableLive('room');p.authorizeLive({approved:true,budgetUSD:10,room:'room'});assert.equal(p.data.autoSession.reservedUSD,9.2);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chino-live-'));try{const file=path.join(dir,'production.json');fs.writeFileSync(file,JSON.stringify(p.data));const restarted=new VideoProduction({file,director:d});assert.equal(restarted.data.autoSession.reservedUSD,9.2);assert.equal(restarted.data.autoSession.enabled,false);assert.equal(restarted.data.autoQueue.some(x=>x.state==='queued'),false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('only fresh live sources may spend; repeated or stale questions never duplicate generation',()=>{
 const {p,offer}=setup();for(const [i,over]of [{source:'microphone'},{source:'operator_test'},{source:'setup'},{t:999},{room:'other'}].entries())assert.equal(offer(i,over).queued,false);
 assert.equal(p.data.autoSession.reservedUSD,0);assert.equal(offer(7).queued,true);assert.equal(offer(7).reason,'production_already_submitted');assert.equal(p.data.autoSession.reservedUSD,1.15);
 assert.throws(()=>p.authorizeLive({approved:true,budgetUSD:10,room:'other'}),/room_changed/);
});
test('provider failure disables automatic production and cannot cause retry storm',async()=>{
 const {p,offer}=setup();let calls=0;p.preflight=async()=>{};p.submit=async()=>{calls++;throw new Error('generation_http_400');};p.verify=async()=>assert.fail();offer(1);offer(2);await p.tickLive();while(p.running)await new Promise(r=>setTimeout(r,1));await p.tickLive();assert.equal(calls,1);assert.equal(p.data.autoSession.enabled,false);assert.equal(p.data.autoSession.error,'generation_http_400');assert.equal(offer(3).queued,false);
});
test('stop during provider preflight prevents a paid submission',async()=>{
 const {p,offer}=setup();let release,calls=0,entered;const inPreflight=new Promise(r=>entered=r);p.preflight=()=>{entered();return new Promise(r=>release=r);};p.submit=async()=>calls++;offer(1);const pending=p.tickLive();await inPreflight;p.stop();release();await pending;assert.equal(calls,0);assert.equal(p.running,false);
});
test('an exact recording found after review is reused without reserving production funds',()=>{
 const {d,p}=setup({catalog:()=>[{id:'answer',text:'וואלה פצצה.',ready:true,file:'test.mp4'}]});d.updateClip('answer',true,['chat','opponent']);
 const e={id:'e',type:'chat',text:'מה שלומך',room:'room',uid:'viewer',source:'tiktools',t:1001,language:'he'},decision={action:'draft',text:'וואלה פצצה.',confidence:1,bankReview:{provider:'openai',eventId:'e',passes:2,noMatchConfirmed:true,libraryRevision:d.bankRevision(e),at:1000}};const row=d.missing(e,decision);assert.equal(p.offerLive(row,e,decision).cached,true);assert.equal(p.data.autoSession.reservedUSD,0);
});
test('chat is interpreted while opponent has the floor; it never speaks over them',async()=>{
 let calls=0,spoken=0;const {d}=setup({decide:async()=>{calls++;return {action:'draft',text:'שמח שהצטרפת',confidence:1,reason:'missing'};},output:()=>spoken++});
 d.setMode('auto');d.heartbeat({id:'s',ready:true});d.receive({type:'opponent',text:'צינו',uid:'opponent'});d.hold('otherSpeaking',true);
 d.receive({type:'chat',text:'צינו פעם ראשונה שלי פה',uid:'viewer',source:'tiktools'});await d.prepareChat();await d.tick();assert.equal(calls,2);assert.equal(spoken,0);assert.equal(d.saved.inbox.at(-1).draft,'שמח שהצטרפת');assert.equal(d.queue.length,1);
});
test('live server refuses microphone bytes before transcription or provider calls',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chino-live-server-'));let system;try{system=createVideoDirector({root:dir,bank:()=>[],emit:()=>{},context:()=>({}),onMode:()=>{},onSpoken:()=>{},productionEnabled:true});const r=await system.audio({source:'microphone',b64:'invalid'});assert.equal(r.reason,'microphone_disabled_in_live');}finally{system?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed background chat interpretation is attempted once, not every timer tick',async()=>{
 let calls=0;const {d}=setup({decide:async()=>{calls++;throw new Error('decision_failed');}});d.setMode('auto');d.receive({type:'chat',text:'צינו תסביר לי משהו חדש',uid:'viewer',source:'tiktools'});await d.prepareChat();await d.prepareChat();assert.equal(calls,1);
});
test('explicit requested retry keeps the same cap and never resumes unrelated jobs',()=>{
 const {d,p,offer}=setup();offer(1);p.data.autoSession.error='generation_http_402';p.data.autoSession.enabled=false;
 const e={type:'audience',text:'הסבר לצאט',source:'setup',room:'room',t:1001,language:'he'},decision={text:'תכתבו צינו בתחילת משפט',confidence:1},row=d.missing(e,decision);
 assert.equal(p.offerLive(row,e,decision,{explicit:true}).reason,'live_production_needs_review');
 assert.equal(p.offerLive(row,e,decision,{explicit:true,approvedRetry:true}).queued,true);assert.equal(p.data.autoSession.reservedUSD,2.3);assert.equal(p.data.autoQueue[0].state,'cancelled');assert.equal(p.data.autoSession.enabled,false);
 p.data.autoSession.error='generation_submission_uncertain';assert.equal(p.offerLive({...row,id:'new'},e,{...decision,text:'נוסח אחר'},{explicit:true,approvedRetry:true}).reason,'live_production_needs_review');
});
test('review accepts the existing checked clip once without generation or another reservation',async()=>{
 let registered=false,submissions=0,accepts=0;
 const clip={id:'reviewed',text:'הסבר חדש',ready:true,file:'checked.mp4'};
 const {d,p,offer}=setup({catalog:()=>registered?[clip]:[]});
 offer(1);p.pauseLive();p.data.autoSession.error='generated_quality_review_required';
 const job={id:'review-job',state:'failed',error:'generated_quality_review_required',sessionId:p.data.autoSession.id,generated:{id:clip.id},key:'הסבר חדש',text:clip.text,transcript:clip.text,review:{score:9,identityStable:true,defects:['Minor fur shading']},rows:[],questions:['הסבר'],roles:['audience'],event:{source:'setup'}};p.data.jobs.push(job);
 p.submit=async()=>submissions++;p.acceptReview=async()=>{accepts++;registered=true;return clip;};
 const decision={id:job.id,accepted:true,generatedId:clip.id,sha256:'a'.repeat(64),note:'Reviewed all three frames; minor shading only.'};
 assert.equal((await p.approveQualityReview(decision)).reusedExistingFile,true);
 assert.equal(job.state,'ready');assert.equal(job.review.defects.length,1);assert.equal(job.manualReview.originalError,'generated_quality_review_required');
 assert.equal(p.data.autoSession.reservedUSD,1.15);assert.equal(p.data.autoSession.error,'');assert.equal(p.data.autoSession.enabled,false);assert.equal(p.data.autoQueue[0].state,'cancelled');
 assert.equal(d.library()[0].auto,false);assert.equal(submissions,0);assert.equal(accepts,1);
 await assert.rejects(p.approveQualityReview(decision),/not_eligible/);
});
test('review cannot approve uncertain jobs, identity failures, wrong words or a changed artifact',async()=>{
 const {p}=setup();let calls=0;p.acceptReview=async()=>{calls++;throw new Error('generated_file_changed');};
 const job={id:'q',state:'failed',error:'generated_quality_review_required',generated:{id:'g'},key:'כן',text:'כן',transcript:'כן',review:{score:9,identityStable:true}};p.data.jobs.push(job);
 const decision={id:'q',generatedId:'g',accepted:true,sha256:'b'.repeat(64),note:'Visual review of sampled frames.'};
 for(const change of [{state:'uncertain'},{error:'generated_words_review_required'},{transcript:'לא'},{review:{score:9,identityStable:false}},{review:{score:3,identityStable:true}}]){
   const before={...job};Object.assign(job,change);await assert.rejects(p.approveQualityReview(decision),/not_eligible/);Object.assign(job,before);
 }
 assert.equal(calls,0);await assert.rejects(p.approveQualityReview(decision),/generated_file_changed/);assert.equal(job.state,'failed');assert.equal(p.running,false);
});


test('operator live lines preserve exact text, reuse recordings and prevent duplicate spend',()=>{
 const {p}=setup({catalog:()=>[{id:'known',text:'משפט מוכן',ready:true,file:'known.mp4'}]});
 const rows=p.offerOperatorLines(['משפט מוכן','משפט חדש שלי','משפט חדש שלי']);
 assert.equal(rows.length,2);assert.equal(rows[0].cached,true);assert.equal(rows[1].queued,true);
 assert.equal(p.data.autoSession.reservedUSD,1.15);
 assert.equal(p.offerOperatorLines(['משפט חדש שלי'])[0].reason,'production_already_submitted');
 assert.equal(p.data.autoSession.reservedUSD,1.15);
 assert.equal(p.data.autoQueue[0].text,'משפט חדש שלי');
});
test('operator lines validate the entire batch and share live budget and failure stop',()=>{
 const {p}=setup();assert.throws(()=>p.offerOperatorLines(['תקין','מילה '.repeat(33)]),/invalid_operator_lines/);
 assert.equal(p.data.autoSession.reservedUSD,0);
 for(let i=0;i<8;i++)assert.equal(p.offerOperatorLines(['משפט '+i])[0].queued,true);
 assert.equal(p.offerOperatorLines(['משפט נוסף'])[0].reason,'live_budget_exhausted');
 p.data.autoSession.error='generation_http_402';
 assert.equal(p.offerOperatorLines(['אחרי שגיאה'])[0].reason,'live_production_needs_review');
 assert.equal(p.data.autoSession.reservedUSD,9.2);
});

test('fifteen dollar authorization preserves prior reservations and includes analysis spending',()=>{const {p,offer}=setup();offer(1);const before=p.data.autoSession.reservedUSD;let analysis=0;p.analysisReserved=()=>analysis;const a=p.authorizeLive({approved:true,budgetUSD:15,room:'room'});assert.equal(a.limitUSD,15);assert.equal(a.reservedUSD,before);analysis=13;assert.equal(p.sessionBudget().totalReservedUSD,14.15);assert.equal(offer(2).reason,'live_budget_exhausted');assert.equal(p.data.autoSession.reservedUSD,before);p.pauseLive();p.authorizeLive({approved:true,budgetUSD:15,room:'room'});assert.equal(p.sessionBudget().totalReservedUSD,14.15);});
