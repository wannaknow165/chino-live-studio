import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningLibrary} from './learning-library.mjs';
function setup(t,options={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chino-study-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let now=Date.now()+10000;
 const lib=new LearningLibrary({directory:dir,inbox:path.join(dir,'Inbox'),now:()=>now,extract:async()=>'',analyze:async()=>({styles:['Observed a short greeting.'],lines:[{when:'greeting',text:'Hello there!'}]}),adopt:async()=>{},...options});return {lib,dir,advance:()=>{now+=61000;}};}
test('all chunks persist, content duplicates skip analysis, restart does not requeue completed jobs',async t=>{
 const {lib,dir,advance}=setup(t);fs.writeFileSync(path.join(lib.inbox,'one.txt'),'hello '.repeat(1500));await lib.tick();assert.equal(lib.state.jobs.length,3);
 for(let i=0;i<3;i++){advance();await lib.tick();}assert.equal(lib.status().counts.analyzed,3);
 fs.writeFileSync(path.join(lib.inbox,'copy.txt'),'hello '.repeat(1500));advance();await lib.tick();assert.equal(lib.state.files.at(-1).status,'duplicate');assert.equal(lib.state.jobs.length,3);
 const next=new LearningLibrary({directory:dir,inbox:lib.inbox});assert.equal(next.status().counts.analyzed,3);assert.equal(next.status().counts.behaviorVerified,0);
});
test('failed AI requests retain source and obey backoff, no paid busy loop',async t=>{
 let calls=0;const {lib}=setup(t,{analyze:async()=>{calls++;throw new Error('budget_limit');}});lib.enqueue('evidence',{hash:'source',kind:'file'});await lib.tick();await lib.tick();assert.equal(calls,1);assert.equal(lib.state.jobs[0].status,'retry');assert.equal(lib.state.jobs[0].text,'evidence');assert.equal(lib.state.lastError,'budget_limit');
});
test('files containing credential patterns are blocked before any cloud request',async t=>{
 const {lib}=setup(t);fs.writeFileSync(path.join(lib.inbox,'secret.txt'),'sk-proj-'+'x'.repeat(40));await lib.tick();assert.equal(lib.state.files[0].status,'failed');assert.equal(lib.state.files[0].error,'sensitive_content_blocked');assert.equal(lib.state.jobs.length,0);
});
test('pause and concurrent ticks never start duplicate requests; no automatic lesson adoption',async t=>{
 let done,calls=0;const {lib}=setup(t,{analyze:()=>{calls++;return new Promise(r=>done=r);}});lib.enqueue('some source',{hash:'one'});lib.state.enabled=false;await lib.tick();assert.equal(calls,0);lib.state.enabled=true;const p=lib.tick();await lib.tick();assert.equal(calls,1);done({styles:['A hypothesis'],lines:[]});await p;assert.equal(lib.status().counts.applied,0);assert.equal(lib.state.lessons[0].checks.behaviorTested,false);
});
test('unsupported and empty documents remain visible, never marked learned',async t=>{
 const {lib}=setup(t);fs.writeFileSync(path.join(lib.inbox,'file.exe'),'x');fs.writeFileSync(path.join(lib.inbox,'empty.pdf'),'x');await lib.tick();assert.equal(lib.state.files.find(f=>f.ext==='.exe').status,'unsupported');assert.equal(lib.state.files.find(f=>f.ext==='.pdf').status,'failed');assert.equal(lib.status().counts.analyzed,0);
});
test('live analysis imports idempotently and only explicit owner action applies a lesson',async t=>{
 let adopted=0;const {lib,dir}=setup(t,{adopt:async()=>{adopted++;}});const file=path.join(dir,'observations.jsonl');fs.writeFileSync(file,JSON.stringify({kind:'analysis_candidate',id:'live1',src:'teacher',styles:['Observed a greeting'],lines:[]})+'\n');await lib.importLive(file);await lib.importLive(file);assert.equal(lib.state.jobs.length,1);await lib.tick();const id=lib.state.lessons[0].id;await lib.applyLesson(id);await lib.applyLesson(id);assert.equal(adopted,1);assert.equal(lib.status().counts.behaviorVerified,0);lib.outcome(id,{success:true,note:'Observed in a real rehearsal.'});assert.equal(lib.status().counts.operatorReportedSuccesses,1);assert.equal(lib.status().counts.behaviorVerified,0);
});
test('daily request ceiling survives restart and does not reset the provider budget',async t=>{
 const {lib,dir}=setup(t);lib.enqueue('some data',{hash:'capped'});lib.state.requests=Array(48).fill(Date.now());lib.save();const other=new LearningLibrary({directory:dir,inbox:lib.inbox});await other.tick();assert.equal(other.state.lastError,'daily_request_limit');assert.equal(other.state.jobs[0].status,'queued');
});
test('large same-source inputs are batched once while every part retains completion and source identity',async t=>{
 let calls=0,packet;const {lib}=setup(t,{analyze:async j=>{calls++;packet=j;return {styles:['Study result'],lines:[]};}});
 lib.enqueue('A'.repeat(23000),{hash:'large-source',kind:'file',name:'lesson.md'});const count=lib.state.jobs.length;
 await lib.tick();assert.equal(calls,1);assert.equal(lib.status().counts.analyzed,count);assert.ok(packet.text.includes('[Source part 6]'));assert.equal(lib.state.lessons[0].source.parts.length,count);
});
test('legacy partial-source lessons cannot be applied as if the full document was studied',async t=>{
 let adopted=false;const {lib}=setup(t,{adopt:async()=>{adopted=true;}});lib.state.lessons.push({id:'legacy',status:'legacy_partial_source',source:{kind:'file'}});
 await assert.rejects(lib.applyLesson('legacy'),/lesson_requires_full_source_reanalysis/);assert.equal(adopted,false);
});
