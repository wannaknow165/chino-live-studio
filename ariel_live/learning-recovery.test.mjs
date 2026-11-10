import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LearningLibrary} from './learning-library.mjs';
function fixture(t,analyze=async()=>({styles:[],lines:[]})){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chino-recovery-test-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let now=1800000000000;
 const options={directory,inbox:path.join(directory,'Inbox'),analyze,extract:async()=>'',adopt:async()=>{},now:()=>now};
 return {options,lib:new LearningLibrary(options),advance:(n=86400001)=>{now+=n;},restart:()=>new LearningLibrary(options)};
}
test('crash during analysis quarantines all parts across restarts without a provider call or new reservation',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});
 f.lib.enqueue('x'.repeat(9000),{hash:'source',kind:'file',name:'source.md'});
 for(const j of f.lib.state.jobs)Object.assign(j,{status:'processing',attempts:1,requestId:'original-batch'});
 f.lib.state.requests=[1799999900000];f.lib.save();
 const next=f.restart();assert.equal(next.status().counts.uncertain,3);assert.equal(next.status().counts.queued,0);
 assert.ok(next.state.jobs.every(j=>j.error==='interrupted_request_outcome_unknown'&&j.requestId==='original-batch'&&j.text.length));
 for(let i=0;i<4;i++){f.advance();await next.tick();}
 assert.equal(calls,0);assert.deepEqual(next.state.requests,[1799999900000]);
 assert.throws(()=>next.retry(next.state.jobs[0].id),/requires_reconciliation/);
 const again=f.restart();await again.tick();assert.equal(calls,0);assert.equal(again.status().counts.uncertain,3);
});
test('timeout after a counted request is quarantined without automatic or manual replay',async t=>{
 let calls=0,reservations=0;const f=fixture(t,async()=>{calls++;reservations++;throw new Error('request_timeout')});
 f.lib.enqueue('source',{hash:'timeout',kind:'file'});await f.lib.tick();const j=f.lib.state.jobs[0];
 assert.equal(j.status,'uncertain');assert.equal(j.attempts,1);assert.ok(j.requestId);assert.equal(j.error,'request_timeout');
 assert.throws(()=>f.lib.retry(j.id),/requires_reconciliation/);
 f.advance();await f.lib.tick();const next=f.restart();f.advance();await next.tick();
 assert.equal(calls,1);assert.equal(reservations,1);assert.equal(next.state.requests.length,1);
});
test('all parts of a timed-out batch share one request identity and remain quarantined',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;throw new Error('connection_reset')});
 f.lib.enqueue('x'.repeat(23000),{hash:'batch',kind:'file'});await f.lib.tick();
 assert.equal(calls,1);assert.equal(f.lib.status().counts.uncertain,6);
 assert.equal(new Set(f.lib.state.jobs.map(j=>j.requestId)).size,1);
 assert.ok(f.lib.state.jobs.every(j=>j.text.length&&j.attempts===1));
 f.advance();await f.restart().tick();assert.equal(calls,1);
});
test('invalid or incomplete responses are not automatically paid for again',async t=>{
 for(const result of [{}, {styles:[],lines:'invalid'}]){
  let calls=0;const f=fixture(t,async()=>{calls++;return result});f.lib.enqueue('source',{hash:'invalid',kind:'file'});
  await f.lib.tick();f.advance();await f.restart().tick();assert.equal(calls,1);assert.equal(f.lib.state.jobs[0].status,'uncertain');
 }
});
test('legacy retry and blocked jobs with ambiguous outcomes become uncertain',t=>{
 const f=fixture(t);f.lib.enqueue('source',{hash:'legacy',kind:'file'});
 const source=f.lib.state.jobs[0];f.lib.state.jobs=['retry','blocked','queued'].map((status,i)=>({...source,id:'legacy-'+i,status,attempts:1,error:i===0?'interrupted_request_outcome_unknown':'processing_failed'}));
 f.lib.save();const next=f.restart();assert.equal(next.status().counts.uncertain,3);assert.equal(next.status().counts.queued,0);
});
test('explicit no-submission failures retain bounded retry without changing budgets or daily limit',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;throw new Error('budget_limit')});f.lib.enqueue('source',{hash:'preflight',kind:'file'});
 await f.lib.tick();assert.equal(f.lib.state.jobs[0].status,'retry');const next=f.restart();assert.equal(next.state.jobs[0].status,'retry');
 f.advance();await next.tick();f.advance();await next.tick();assert.equal(calls,3);assert.equal(next.state.jobs[0].status,'blocked');
 f.advance();await next.tick();assert.equal(calls,3);
});
test('manual retry cannot replay completed or superseded analysis',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});f.lib.enqueue('source',{hash:'done',kind:'file'});await f.lib.tick();
 const j=f.lib.state.jobs[0];assert.equal(j.status,'analyzed');assert.throws(()=>f.lib.retry(j.id),/retry_not_safe/);
 j.status='superseded';assert.throws(()=>f.lib.retry(j.id),/retry_not_safe/);assert.equal(calls,1);
});
test('quarantined jobs do not prevent new distinct sources from processing',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});f.lib.enqueue('unknown',{hash:'old',kind:'file'});
 Object.assign(f.lib.state.jobs[0],{status:'processing',attempts:1});f.lib.save();const next=f.restart();next.enqueue('new source',{hash:'new',kind:'file'});await next.tick();
 assert.equal(calls,1);assert.equal(next.status().counts.uncertain,1);assert.equal(next.status().counts.analyzed,1);
});

test('legacy manual retry cannot hide an ambiguous prior attempt by resetting the attempt counter',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});f.lib.enqueue('source',{hash:'reset',kind:'file'});
 Object.assign(f.lib.state.jobs[0],{status:'queued',attempts:0,error:'processing_failed'});f.lib.save();
 const next=f.restart();f.advance();await next.tick();assert.equal(next.status().counts.uncertain,1);assert.equal(calls,0);
});
