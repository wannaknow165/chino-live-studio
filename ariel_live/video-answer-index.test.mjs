import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {VideoAnswerIndex,intentOf} from './video-answer-index.mjs';
import {VideoDirector} from './video-director.mjs';
import {VideoProduction} from './video-production.mjs';
import {SingleAttemptVideoProvider} from './video-production-provider.mjs';
const answer={id:'well',text:'וואלה מעולה, מה איתך?',file:'well.mp4',language:'he',ready:true,auto:true,roles:['opponent','chat']};
const event={text:'מה שלומך?',type:'opponent',uid:'a',room:'room',language:'he'};
test('Hebrew and English paraphrases share intents, compound/contextual questions do not',()=>{
 for(const q of ['מה נשמע?','מה המצב','צ׳ינו, איך אתה?','תגיד צינו מה שלומך','מה איתך אח שלי','how are you doing'])assert.equal(intentOf(q),'wellbeing',q);
 for(const q of ['מה שלומך אחרי שהפסדת','מה שלומך ומה הניקוד','איך אתה יודע את השם שלי','מה קורה לצאט'])assert.equal(intentOf(q),'',q);
});
test('semantic replay survives restart; missing/replaced media and persona change invalidate it',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'answer-index-'));
 try{const file=path.join(dir,'index.json');let ix=new VideoAnswerIndex({file});ix.sync([answer]);ix.remember(event,answer,{reusable:true,persona:'chino'});ix=new VideoAnswerIndex({file});
 assert.equal(ix.lookup({...event,text:'איך הולך',uid:'other'},[answer],'chino').clipId,'well');
 assert.equal(ix.lookup(event,[],'chino'),null);assert.equal(ix.lookup(event,[{...answer,text:'changed'}],'chino'),null);assert.equal(ix.lookup(event,[answer],'new persona'),null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('personal names, question-only clips and dynamic claims never become global fast answers',()=>{
 const ix=new VideoAnswerIndex();for(const text of ['שלום דני','מה שלומך?','אני מוביל 30 נקודות','טוב את ניצחת','מעולה, איך בתל אביב?']){const c={...answer,text};assert.equal(ix.remember(event,c,{reusable:true}).reusable,false);assert.equal(ix.lookup(event,[c]),null);}
});
test('word similarity only ranks candidates; it does not authorize playback',()=>{
 const ix=new VideoAnswerIndex();const q={...answer,id:'question',text:'מה שלומך?'};ix.sync([q,answer]);assert.equal(ix.rank(event,[answer,q])[0].id,'question');assert.equal(ix.lookup(event,[q,answer]),null);
});
function director(extra={}){return new VideoDirector({catalog:()=>[answer],providerStatus:()=>({configured:true}),output:()=>{},context:()=>({}),...extra});}
test('indexed paraphrases still require a fresh model decision',async()=>{
 let calls=0;const d=director({decide:async()=>{calls++;return{action:'play',clipId:answer.id,text:answer.text,confidence:1,reusable:true,reason:'fits'};}});d.updateClip(answer.id,true,answer.roles);d.heartbeat({id:'s',ready:true});d.setMode('auto');d.receive({...event,text:'צינו מה שלומך'});await d.tick();assert.equal(calls,1);
 const result=await d.choose({...event,text:'מה המצב'},new AbortController().signal);assert.equal(result.clipId,answer.id);assert.equal(result.bankReview.passes,1);assert.equal(calls,2);
 d.updateClip(answer.id,false,answer.roles);assert.equal(d.eligible(event).length,0);
});
test('full answer journal survives rolling dashboard history and unresolved requests are kept',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'answer-journal-'));try{const file=path.join(dir,'state.json');const d=director({file});for(let i=0;i<260;i++)d.missing({...event,text:'שאלה '+i},{text:'תשובה '+i,reason:'missing'});assert.equal(d.saved.inbox.length,260);assert.equal(fs.readFileSync(path.join(dir,'answers.jsonl'),'utf8').trim().split('\n').length,261);const reopened=director({file});assert.equal(reopened.saved.inbox.length,260);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('missing paraphrases coalesce without losing the original draft or variants',()=>{
 const d=director();const a=d.missing(event,{text:'נוסח מקורי',reason:'missing'});const b=d.missing({...event,text:'מה המצב'}, {text:'עוד נוסח',reason:'missing'});assert.equal(a.id,b.id);assert.equal(b.draft,'נוסח מקורי');assert.equal(b.variants.length,2);
});
test('coalesced missing answer still changes conversation status to waiting for a clip',()=>{
 const d=director();d.setRoom('room');d.receive({...event,text:'צינו מה שלומך'});d.missing(event,{text:'נוסח',reason:'missing'});d.dialogue.state='responding';d.missing({...event,text:'מה המצב'},{text:'עוד נוסח',reason:'missing'});assert.equal(d.dialogueStatus().state,'needs_video');assert.equal(d.dialogueStatus().secondsLeft,120);
});
test('production deduplicates wellbeing and excludes silence/filter cases and existing clips',()=>{
 const d=director();d.missing(event,{text:'חדש',reason:'missing'});const row=d.missing({...event,text:'שקט'}, {text:'',reason:'listen'});row.practice={action:'listen'};const p=new VideoProduction({director:d});const plan=p.plan();assert.equal(plan.missing,1);assert.equal(plan.items.find(x=>x.intent==='wellbeing').clipId,'well');assert.equal(plan.items.find(x=>x.intent==='wake').text,'דבר');
});
test('no paid request occurs without approval or beyond explicit batch limit',async()=>{
 const d=director();let submits=0;const p=new VideoProduction({director:d,preflight:async()=>{},submit:async()=>{submits++;},verify:async()=>{throw new Error('test_failed');}});
 await assert.rejects(()=>p.start({maxClips:1,budgetUSD:1.15}),/approval_required/);await assert.rejects(()=>p.start({approved:true,maxClips:1,budgetUSD:1}),/nothing_within_limit/);assert.equal(submits,0);
 await p.start({approved:true,maxClips:1,budgetUSD:1.15});while(p.running)await new Promise(r=>setTimeout(r,1));assert.equal(submits,1);assert.equal(p.data.jobs[0].state,'failed');assert.equal(d.library()[0].auto,false);
});
test('double start is rejected during preflight and an unverified clip never becomes ready',async()=>{
 const d=director();let release;const p=new VideoProduction({director:d,preflight:()=>new Promise(r=>release=r),submit:async()=>{},verify:async()=>null});const first=p.start({approved:true,maxClips:1,budgetUSD:1.15});await assert.rejects(()=>p.start({approved:true,maxClips:1,budgetUSD:1.15}),/already_running/);release();await first;while(p.running)await new Promise(r=>setTimeout(r,1));assert.equal(p.data.jobs[0].state,'failed');
});
test('uncertain generation survives restart and is never automatically submitted again',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'production-restart-'));try{const file=path.join(dir,'production.json');fs.writeFileSync(file,JSON.stringify({version:1,batch:null,jobs:[{id:'job',key:'דבר',text:'דבר',state:'generating'}]}));const p=new VideoProduction({file,director:director()});assert.equal(p.data.jobs[0].state,'uncertain');assert.equal(p.plan().missing,0);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('quote approval freezes the literal edited answer and never submits twice',async()=>{
 const d=director();const row=d.missing(event,{text:'draft',reason:'missing'});let calls=0,sent='';
 const p=new VideoProduction({director:d,preflight:async()=>{},submit:async job=>{calls++;sent=job.text;},verify:async()=>{throw new Error('test_failed');}});
 const quote=p.quote({id:row.id,text:'נוסח מדויק שהמשתמש ערך'});
 assert.equal(calls,0);assert.equal(quote.price.maxAttempts,1);assert.equal(quote.price.maxVideoUSD,1.05);
 await assert.rejects(()=>p.approveQuote({quoteId:quote.id}),/approval_required/);
 await p.approveQuote({quoteId:quote.id,approved:true});while(p.running)await new Promise(r=>setTimeout(r,1));
 await p.approveQuote({quoteId:quote.id,approved:true});assert.equal(calls,1);assert.equal(sent,quote.text);assert.equal(p.data.batch.maxClips,1);
});
test('quoted text already in the bank binds the existing clip with zero generation calls',async()=>{
 const d=director();const row=d.missing(event,{text:answer.text,reason:'missing'});const p=new VideoProduction({director:d,submit:async()=>assert.fail('must not generate')});
 const q=p.quote({id:row.id,text:answer.text});assert.equal(q.existingClipId,answer.id);assert.equal((await p.approveQuote({quoteId:q.id,approved:true})).cached,true);assert.equal(row.videoReady,true);
});
test('expired approval cannot trigger a paid job',async()=>{
 let t=100;const d=director();const row=d.missing(event,{text:'missing',reason:'missing'});const p=new VideoProduction({director:d,now:()=>t,submit:async()=>assert.fail('must not generate')});const q=p.quote({id:row.id,text:'missing'});t+=300001;await assert.rejects(()=>p.approveQuote({quoteId:q.id,approved:true}),/quote_expired/);
});
test('several appropriate answers rotate instead of repeating the same recording',()=>{
 let time=100;const ix=new VideoAnswerIndex({now:()=>time++});const a=answer,b={...answer,id:'second',text:'הכול טוב'};
 ix.sync([a,b]);ix.remember(event,a,{reusable:true});ix.remember(event,b,{reusable:true});
 const first=ix.lookup(event,[a,b]);const second=ix.lookup({...event,text:'מה המצב'},[a,b]);assert.notEqual(first.clipId,second.clipId);
 assert.equal(ix.lookup({...event,text:'מה שלומך אחרי הבאטל'},[a,b]),null);
});
test('single-attempt adapter uses the existing model/reference and never retries a paid failure',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chino-generation-'));try{
 fs.mkdirSync(path.join(dir,'media'));fs.writeFileSync(path.join(dir,'media','master.png'),'fixture');let calls=0,captured;
 const p=new SingleAttemptVideoProvider({root:dir,fetchImpl:async(url,opts)=>{calls++;captured=JSON.parse(opts.body);return {ok:true,json:async()=>({outputs:[{type:'video',data:Buffer.from('fixture-video').toString('base64')}]})};}});p.key=()=> 'unit-test-only';
 const result=await p.generate({text:'דבר'});assert.equal(calls,1);assert.equal(result.attempts,1);assert.equal(captured.model,'gemini-omni-1.2-flash');assert.equal(captured.response_format.resolution,'720p');assert.ok(fs.existsSync(path.join(dir,'media','generated',result.file)));
 p.fetchImpl=async()=>{calls++;return {ok:false,status:429}};await assert.rejects(()=>p.generate({text:'דבר'}),/generation_rate_or_quota/);assert.equal(calls,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
