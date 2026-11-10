import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {LearningLibrary} from './learning-library.mjs';
import {migrateFullSource,createLearningRunner} from './learning-worker-lifecycle.mjs';

function fixture(t,analyze=async()=>({styles:[],lines:[]})){
  const directory=fs.mkdtempSync(path.join(import.meta.dirname,'revision-test-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let now=Date.now()+10000;
  const options={directory,inbox:path.join(directory,'Inbox'),analyze,extract:async()=>'',adopt:async()=>{},now:()=>now};
  return {options,lib:new LearningLibrary(options),advance:(ms=86400001)=>{now+=ms;},restart:()=>new LearningLibrary(options)};
}
function legacy(j,overrides={}){
  delete j.attemptLogVersion;delete j.analysisAttempts;
  return Object.assign(j,{status:'retry',attempts:2,error:'local_rate_limit',retryAt:0},overrides);
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));

for(const status of ['queued','retry','blocked','superseded'])test(`historical timeout behind local rejection remains quarantined (${status})`,async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});
  f.lib.enqueue('source',{hash:'mixed',kind:'file'});const j=legacy(f.lib.state.jobs[0],{status,attempts:status==='queued'?0:2});
  const historyId=j.id;if(status==='superseded')j.id='legacy-'+j.id;
  f.lib.state.history=[{kind:'analysis_failed',jobId:historyId,error:'request_timeout',at:1},{kind:'analysis_failed',jobId:historyId,error:'local_rate_limit',at:2}];
  f.lib.state.requests=[1,2];const history=structuredClone(f.lib.state.history);f.lib.save();
  const next=f.restart();assert.equal(next.state.jobs[0].status,'uncertain');
  assert.equal(next.state.jobs[0].error,'local_rate_limit');assert.equal(next.state.jobs[0].text,'source');
  assert.throws(()=>next.retry(j.id),/requires_reconciliation/);f.advance();await next.tick();
  assert.equal(calls,0);assert.deepEqual(next.state.requests,[1,2]);assert.deepEqual(next.state.history,history);
});

for(const mode of ['missing','truncated','only-safe','counter-reset'])test(`legacy attempt evidence fails closed when ${mode}`,async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});
  f.lib.enqueue('source',{hash:mode,kind:'file'});const j=legacy(f.lib.state.jobs[0]);
  if(mode==='truncated')f.lib.state.history=Array.from({length:2000},(_,i)=>({kind:'file_detected',fileId:'other-'+i}));
  if(mode==='only-safe')f.lib.state.history=[{kind:'analysis_failed',jobId:j.id,error:'budget_limit'}];
  if(mode==='counter-reset')j.attempts=0;
  f.lib.save();const next=f.restart();f.advance();await next.tick();
  assert.equal(calls,0);assert.equal(next.state.jobs[0].status,'uncertain');
});

test('genuinely untouched legacy queue remains eligible',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});
  f.lib.enqueue('source',{hash:'untouched',kind:'file'});legacy(f.lib.state.jobs[0],{status:'queued',attempts:0,error:''});
  f.lib.save();await f.restart().tick();assert.equal(calls,1);
});

test('safe rejection followed by timeout never starts a third request',async t=>{
  let calls=0,reservations=0;const f=fixture(t,async()=>{calls++;if(calls===1)throw new Error('local_rate_limit');reservations++;throw new Error('request_timeout');});
  f.lib.enqueue('source',{hash:'safe-then-unknown',kind:'file'});await f.lib.tick();
  f.advance();const next=f.restart();await next.tick();
  assert.deepEqual(next.state.jobs[0].analysisAttempts.map(a=>a.outcome),['pre_submission_rejected','uncertain']);
  next.state.history=Array.from({length:2000},()=>({kind:'file_detected'}));next.save();
  f.advance();await f.restart().tick();assert.equal(calls,2);assert.equal(reservations,1);
});

test('journal ambiguity wins over a later safe error even after event-history truncation',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});
  f.lib.enqueue('source',{hash:'journal',kind:'file'});const j=f.lib.state.jobs[0];
  Object.assign(j,{status:'retry',attempts:2,error:'local_rate_limit',analysisAttempts:[{requestId:'unknown',outcome:'uncertain',error:'request_timeout'},{requestId:'safe',outcome:'pre_submission_rejected',error:'local_rate_limit'}]});
  f.lib.state.history=[];f.lib.save();const next=f.restart();f.advance();await next.tick();
  assert.equal(next.state.jobs[0].status,'uncertain');assert.equal(calls,0);assert.equal(next.state.jobs[0].analysisAttempts.length,2);
});

test('safe journals survive restart and manual retry never resets attempts or bypasses the cap',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;throw new Error('budget_limit');});
  f.lib.enqueue('source',{hash:'safe-journal',kind:'file'});await f.lib.tick();let next=f.restart();
  for(let n=1;n<3;n++){next.retry(next.state.jobs[0].id);assert.equal(next.state.jobs[0].attempts,n);f.advance();await next.tick();next=f.restart();}
  const j=next.state.jobs[0];assert.equal(j.status,'blocked');assert.equal(j.attempts,3);assert.equal(j.analysisAttempts.length,3);
  assert.throws(()=>next.retry(j.id),/retry_limit/);f.advance();await next.tick();assert.equal(calls,3);
});

test('new attempt record and daily accounting are durable before analyze begins',async t=>{
  let observed=false;const f=fixture(t,async()=>{
    const disk=JSON.parse(fs.readFileSync(f.lib.file,'utf8')),j=disk.jobs[0];
    assert.equal(j.status,'processing');assert.equal(j.analysisAttempts[0].outcome,'pending');
    assert.equal(j.analysisAttempts[0].requestId,j.requestId);assert.equal(disk.requests.length,1);observed=true;
    return {styles:[],lines:[]};
  });
  f.lib.enqueue('source',{hash:'durable',kind:'file'});await f.lib.tick();assert.equal(observed,true);
});

test('old superseded ambiguity blocks regenerated same-source IDs but not distinct sources',async t=>{
  const processed=[];const f=fixture(t,async j=>{processed.push(j.source.hash);return {styles:[],lines:[]}});
  f.lib.enqueue('old',{hash:'same',kind:'file',fileId:'original'});legacy(f.lib.state.jobs[0],{status:'superseded',error:'request_timeout'});
  f.lib.state.jobs.push({id:'new-id',source:{hash:'same',kind:'file',fileId:'new-file'},text:'regenerated',status:'queued',attempts:0,error:''});
  f.lib.save();const next=f.restart();assert.throws(()=>next.enqueue('another rendering',{hash:'same',kind:'file'}),/source_requires_reconciliation/);
  next.enqueue('different',{hash:'different',kind:'file'});await next.tick();assert.deepEqual(processed,['different']);
  assert.equal(next.state.jobs.find(j=>j.id==='new-id').status,'queued');
});

test('real legacy migration fails closed without renaming, reindexing, or losing accounting',async t=>{
  let calls=0,imports=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});
  f.lib.enqueue('source',{hash:'migration',kind:'file',fileId:'file'});legacy(f.lib.state.jobs[0],{error:'request_timeout'});
  f.lib.state.files=[{id:'file',status:'indexed',hash:'migration',name:'original.pdf'}];
  f.lib.state.lessons=[{id:'lesson',status:'candidate',source:{kind:'file',fileId:'file'}}];f.lib.state.requests=[12,34];f.lib.save();
  const next=f.restart(),before=structuredClone(next.state);const migrationReady=migrateFullSource(next);
  assert.equal(migrationReady,false);assert.deepEqual(next.state.jobs,before.jobs);assert.deepEqual(next.state.files,before.files);assert.deepEqual(next.state.lessons,before.lessons);assert.deepEqual(next.state.requests,[12,34]);assert.equal(next.state.analysisVersion,undefined);
  const runner=createLearningRunner({library:next,migrationReady,importSource:async()=>{imports++;}});
  for(let i=0;i<3;i++){f.advance();await runner.cycle();}
  assert.equal(calls,0);assert.equal(imports,0);assert.equal(next.state.lastError,'analysis_migration_requires_reconciliation');
  const again=f.restart();assert.equal(migrateFullSource(again),false);assert.equal(again.state.jobs[0].id,before.jobs[0].id);
});

test('real safe migration still preserves the legacy audit and runs exactly once',t=>{
  const f=fixture(t);f.lib.enqueue('old',{hash:'old',kind:'file',fileId:'file'});
  f.lib.state.files=[{id:'file',status:'indexed'}];f.lib.state.lessons=[];
  const id=f.lib.state.jobs[0].id;assert.equal(migrateFullSource(f.lib),true);
  assert.equal(f.lib.state.files[0].status,'queued');assert.equal(f.lib.state.jobs[0].id,'legacy-'+id);assert.equal(f.lib.state.jobs[0].status,'superseded');assert.equal(f.lib.state.lessons.length,0);
  const before=structuredClone(f.lib.state);assert.equal(migrateFullSource(f.lib),true);assert.deepEqual(f.lib.state,before);
});

test('already-current migration leaves quarantine intact and permits distinct safe work',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});
  f.lib.state.analysisVersion='full_source_v2';f.lib.enqueue('old',{hash:'old',kind:'file'});f.lib.state.jobs[0].status='uncertain';
  f.lib.enqueue('new',{hash:'new',kind:'file'});assert.equal(migrateFullSource(f.lib),true);await f.lib.tick();assert.equal(calls,1);assert.equal(f.lib.state.jobs[0].status,'uncertain');
});

test('worker shutdown drains active analysis and server before stopping transcriber or exit',async t=>{
  const result=deferred(),started=deferred(),closed=deferred(),events=[];
  const f=fixture(t,()=>{started.resolve();return result.promise;});f.lib.enqueue('source',{hash:'drain',kind:'file'});
  const runner=createLearningRunner({library:f.lib,migrationReady:true,importSource:async()=>{}});
  const active=runner.cycle();await started.promise;
  const options={stopScheduling:()=>events.push('timer-stop'),closeServer:()=>{events.push('server-close');return closed.promise;},stopTranscriber:()=>events.push('transcriber-stop'),exit:()=>events.push('exit')};
  const stop=runner.shutdown(options);assert.equal(runner.shutdown(options),stop);assert.equal(runner.stopping,true);
  runner.cycle();await turn();assert.deepEqual(events,['timer-stop','server-close']);
  result.resolve({styles:[],lines:[]});await active;await turn();assert.equal(f.lib.state.jobs[0].status,'analyzed');assert.deepEqual(events,['timer-stop','server-close']);
  closed.resolve();await stop;assert.deepEqual(events,['timer-stop','server-close','transcriber-stop','exit']);
  const disk=JSON.parse(fs.readFileSync(f.lib.file,'utf8'));assert.equal(disk.jobs[0].analysisAttempts[0].outcome,'completed');
});

test('shutdown during import waits for it and starts no analysis',async t=>{
  const imported=deferred();let calls=0,exits=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});f.lib.enqueue('source',{hash:'import',kind:'file'});
  const runner=createLearningRunner({library:f.lib,migrationReady:true,importSource:()=>imported.promise});runner.cycle();
  const stop=runner.shutdown({stopScheduling(){},closeServer:async()=>{},stopTranscriber(){},exit(){exits++;}});
  await turn();assert.equal(exits,0);imported.resolve();await stop;assert.equal(calls,0);assert.equal(exits,1);assert.equal(f.lib.state.jobs[0].status,'queued');
});

test('shutdown waits for admitted lesson adoption and rejects new mutations',async t=>{
  const adopted=deferred();const f=fixture(t);f.options.adopt=()=>adopted.promise;f.lib.adopt=f.options.adopt;
  f.lib.state.lessons=[{id:'lesson',status:'candidate',source:{kind:'file'}}];const apply=f.lib.applyLesson('lesson');
  const runner=createLearningRunner({library:f.lib,migrationReady:true,importSource:async()=>{}});let exits=0;
  const stop=runner.shutdown({stopScheduling(){},closeServer:async()=>{},stopTranscriber(){},exit(){exits++;}});
  await turn();assert.equal(exits,0);await assert.rejects(f.lib.applyLesson('lesson'),/worker_stopping/);assert.throws(()=>f.lib.retry('anything'),/worker_stopping/);
  adopted.resolve();await apply;await stop;assert.equal(exits,1);assert.equal(f.lib.state.lessons[0].adopted,true);
});

test('worker production wiring uses the tested migration and drain path without forwarding audit IDs',()=>{
  const worker=fs.readFileSync(new URL('./learning-worker.mjs',import.meta.url),'utf8');
  assert.match(worker,/const migrationReady=migrateFullSource\(library\)/);assert.match(worker,/runner\.shutdown\(/);assert.match(worker,/if\(runner.stopping\)return json/);
  assert.match(worker,/analyze:async j=>director\([^\n]+\{text:j.text,images:/);assert.doesNotMatch(worker,/requestId/);
});

test('legacy manual retry of a completed job is recognized after history truncation',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});f.lib.enqueue('source',{hash:'legacy-completed',kind:'file'});
  legacy(f.lib.state.jobs[0],{status:'queued',attempts:0,error:'',text:'',finishedAt:123,analysisVersion:'legacy_review'});f.lib.state.history=[];f.lib.save();
  const next=f.restart();await next.tick();assert.equal(calls,0);assert.equal(next.state.jobs[0].status,'uncertain');
});

test('incomplete or inconsistent new journals fail closed',async t=>{
  for(const entries of [[],[{requestId:'a',outcome:'pre_submission_rejected',error:'request_timeout'}],[{requestId:'a',outcome:'pre_submission_rejected',error:'budget_limit'}]]){
    let calls=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});f.lib.enqueue('source',{hash:'incomplete',kind:'file'});
    Object.assign(f.lib.state.jobs[0],{status:'retry',attempts:2,error:'budget_limit',analysisAttempts:entries});f.lib.save();const next=f.restart();await next.tick();
    assert.equal(calls,0);assert.equal(next.state.jobs[0].status,'uncertain');
  }
});

test('migration of completed old analysis fails closed and preserves its result',t=>{
  const f=fixture(t);f.lib.enqueue('old',{hash:'completed-migration',kind:'file',fileId:'file'});
  legacy(f.lib.state.jobs[0],{status:'analyzed',attempts:1,error:'',text:'',finishedAt:123});f.lib.state.files=[{id:'file',status:'indexed'}];
  const before=structuredClone(f.lib.state);assert.equal(migrateFullSource(f.lib),false);const next=f.restart();assert.equal(next.state.jobs[0].status,'analyzed');assert.deepEqual(next.state.jobs,before.jobs);assert.deepEqual(next.state.files,before.files);assert.equal(next.state.analysisVersion,undefined);
});

test('shutdown persists a timeout as uncertain before exit and never replays it',async t=>{
  const request=deferred(),started=deferred();let calls=0;const f=fixture(t,()=>{calls++;started.resolve();return request.promise;});f.lib.enqueue('source',{hash:'shutdown-timeout',kind:'file'});
  const runner=createLearningRunner({library:f.lib,migrationReady:true,importSource:async()=>{}});runner.cycle();await started.promise;
  let disk;const stop=runner.shutdown({stopScheduling(){},closeServer:async()=>{},stopTranscriber(){},exit(){disk=JSON.parse(fs.readFileSync(f.lib.file,'utf8'));}});
  request.reject(new Error('request_timeout'));await stop;assert.equal(disk.jobs[0].status,'uncertain');assert.equal(disk.jobs[0].analysisAttempts[0].outcome,'uncertain');
  f.advance();await f.restart().tick();assert.equal(calls,1);
});

test('shutdown leaves extraction alive until its admitted tick saves',async t=>{
  const extraction=deferred(),started=deferred();const f=fixture(t);f.lib.extract=()=>{started.resolve();return extraction.promise;};
  fs.writeFileSync(path.join(f.lib.inbox,'source.pdf'),'mock document');const runner=createLearningRunner({library:f.lib,migrationReady:true,importSource:async()=>{}});runner.cycle();await started.promise;
  let stopped=false;const stop=runner.shutdown({stopScheduling(){},closeServer:async()=>{},stopTranscriber(){stopped=true;},exit(){}});
  await turn();assert.equal(stopped,false);extraction.resolve('local extracted text');await stop;assert.equal(stopped,true);assert.equal(f.lib.state.files[0].status,'indexed');assert.equal(f.lib.state.jobs[0].status,'queued');
});

test('one-minute request spacing and 48-per-day ceiling remain unchanged',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return {styles:[],lines:[]}});
  f.lib.enqueue('first',{hash:'first',kind:'file'});f.lib.enqueue('second',{hash:'second',kind:'file'});await f.lib.tick();await f.lib.tick();assert.equal(calls,1);
  f.advance(60001);await f.lib.tick();assert.equal(calls,2);f.lib.enqueue('third',{hash:'third',kind:'file'});
  f.lib.state.requests=Array(48).fill(f.options.now());f.lib.save();const next=f.restart();f.advance(60001);await next.tick();assert.equal(calls,2);assert.equal(next.state.lastError,'daily_request_limit');assert.equal(next.state.requests.length,48);
});
import {acquireWorkerLock,createWorkerScheduling} from './learning-worker-lifecycle.mjs';
import {fork} from 'node:child_process';

for(const text of ['{"pid":99999999}', 'not-json', ''])test(`existing lock fails closed and is not deleted (${text||'empty'})`,t=>{
  const f=fixture(t),lock=path.join(f.options.directory,'worker.lock');fs.writeFileSync(lock,text);
  assert.throws(()=>acquireWorkerLock(f.options.directory),/lock_requires_reconciliation/);assert.equal(fs.readFileSync(lock,'utf8'),text);
});

test('exclusive lock release is idempotent and cannot release a replacement claim',t=>{
  const f=fixture(t),lock=path.join(f.options.directory,'worker.lock');const release=acquireWorkerLock(f.options.directory);
  assert.throws(()=>acquireWorkerLock(f.options.directory),/lock_requires_reconciliation/);release();assert.equal(fs.existsSync(lock),false);
  const next=acquireWorkerLock(f.options.directory);release();assert.equal(fs.existsSync(lock),true);next();assert.equal(fs.existsSync(lock),false);
});

test('simultaneous isolated worker starts admit exactly one state owner before any mock submission', {timeout:15000},async t=>{
  const f=fixture(t),childFile=path.join(f.options.directory,'lock-contender.mjs');
  fs.writeFileSync(childFile,`
    import fs from 'node:fs';import path from 'node:path';
    import {acquireWorkerLock} from ${JSON.stringify(new URL('./learning-worker-lifecycle.mjs',import.meta.url).href)};
    let release;
    process.on('message',message=>{
      if(message==='claim'){
        try{release=acquireWorkerLock(process.argv[2]);
          fs.appendFileSync(path.join(process.argv[2],'mock-submissions.log'),process.pid+'\\n');
          process.send({kind:'owner',pid:process.pid});
        }catch(e){process.send({kind:'blocked',error:e.message});}
      }
      if(message==='finish'){release?.();process.exit(0);}
    });process.send({kind:'ready'});
  `);
  const children=[];
  try{
    for(let i=0;i<2;i++){
      const child=fork(childFile,[f.options.directory],{execArgv:['--import',new URL('./learning-test-no-network.mjs',import.meta.url).href],stdio:['ignore','pipe','pipe','ipc']});
      const messages=[];let err='';child.stderr.on('data',x=>err+=x);child.on('message',x=>messages.push(x));
      children.push({child,messages,err:()=>err});
    }
    const waitFor=async predicate=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw new Error('child barrier failed: '+children.map(x=>x.err()).join('\n'));};
    await waitFor(()=>children.every(x=>x.messages.some(m=>m.kind==='ready')));
    // Both processes are alive at the same admission barrier before either claims.
    for(const {child} of children)child.send('claim');
    await waitFor(()=>children.every(x=>x.messages.some(m=>['owner','blocked'].includes(m.kind))));
    const outcomes=children.flatMap(x=>x.messages).filter(m=>m.kind!=='ready');assert.equal(outcomes.filter(m=>m.kind==='owner').length,1);assert.equal(outcomes.filter(m=>m.kind==='blocked').length,1);
    assert.equal(outcomes.find(m=>m.kind==='blocked').error,'learning_worker_lock_requires_reconciliation');
    const claims=fs.readFileSync(path.join(f.options.directory,'mock-submissions.log'),'utf8').trim().split('\n');assert.equal(claims.length,1);
    const owner=JSON.parse(fs.readFileSync(path.join(f.options.directory,'worker.lock'),'utf8'));assert.equal(owner.pid,outcomes.find(m=>m.kind==='owner').pid);
  }finally{
    await Promise.all(children.map(({child})=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.send('finish');})));
  }
  assert.equal(fs.existsSync(path.join(f.options.directory,'worker.lock')),false);
});

test('no cycles or timers before listen success, failed startup stays idle, start is idempotent',async()=>{
  let calls=0,schedules=0,cancels=0;const runner={stopping:false,cycle:()=>{calls++;}};
  const options={schedule:()=>{schedules++;return 123;},cancel:id=>{assert.equal(id,123);cancels++;}};
  const failed=createWorkerScheduling(runner,options);assert.equal(calls,0);assert.equal(schedules,0);failed.stop();failed.start();assert.equal(calls,0);
  const live=createWorkerScheduling(runner,options);assert.equal(calls,0);live.start();live.start();assert.equal(calls,1);assert.equal(schedules,1);live.stop();live.stop();assert.equal(cancels,1);
});

test('production startup claims ownership before loading library and starts work only in listen callback',()=>{
  const worker=fs.readFileSync(new URL('./learning-worker.mjs',import.meta.url),'utf8');
  assert.ok(worker.indexOf('const release=acquireWorkerLock(directory)')<worker.indexOf('const library=new LearningLibrary'));
  assert.match(worker,/server\.listen\(port,'127.0.0.1',\(\)=>\{scheduling.start\(\)/);assert.doesNotMatch(worker,/runner\.cycle\(/);assert.doesNotMatch(worker,/process\.kill\(previous.pid|flag:'w'/);
});

test('legacy completed lessons without surviving jobs also block automatic paid reindex',t=>{
  const f=fixture(t);f.lib.state.files=[{id:'file',status:'indexed'}];f.lib.state.lessons=[{id:'done',source:{kind:'file',fileId:'file'},summary:'Saved result',status:'candidate'}];
  const before=structuredClone(f.lib.state);assert.equal(migrateFullSource(f.lib),false);assert.deepEqual(f.lib.state.files,before.files);assert.deepEqual(f.lib.state.lessons,before.lessons);assert.equal(f.lib.state.analysisVersion,undefined);
});

for(const retainHistory of [true,false])test(`completed source cannot be paid for again by real migration and ingest (history=${retainHistory})`,async t=>{
  let calls=0,reservations=0;const f=fixture(t,async()=>{calls++;reservations++;return {styles:['Retained analysis'],lines:[]}});
  fs.writeFileSync(path.join(f.lib.inbox,'completed.txt'),'Completed original evidence');await f.lib.tick();await f.lib.tick();
  assert.equal(calls,1);assert.equal(f.lib.state.jobs[0].status,'analyzed');
  if(!retainHistory)f.lib.state.history=[];f.lib.save();const next=f.restart();const before=structuredClone(next.state);
  const migrationReady=migrateFullSource(next);assert.equal(migrationReady,false);
  const runner=createLearningRunner({library:next,migrationReady,importSource:async()=>{}});
  for(let i=0;i<3;i++){f.advance();await runner.cycle();await next.tick();}
  assert.equal(calls,1);assert.equal(reservations,1);assert.deepEqual(next.state.requests,before.requests);assert.deepEqual(next.state.jobs,before.jobs);assert.deepEqual(next.state.files,before.files);assert.deepEqual(next.state.lessons,before.lessons);
  assert.equal(next.state.analysisVersion,undefined);assert.equal(next.state.jobs[0].status,'analyzed');
});

test('untouched legacy migration completes every batch without alias-history quarantine',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return {styles:['Full source result'],lines:[]}});
  fs.writeFileSync(path.join(f.lib.inbox,'long.txt'),'a'.repeat(60000));await f.lib.tick();assert.equal(f.lib.state.jobs.length,15);
  assert.equal(migrateFullSource(f.lib),true);assert.ok(f.lib.state.jobs.every(j=>j.status==='superseded'&&j.legacyEventHistory.length===0));
  await f.lib.tick();assert.equal(f.lib.state.jobs.length,30);await f.lib.tick();assert.equal(calls,1);assert.equal(f.lib.status().counts.analyzed,12);
  f.advance(60001);await f.lib.tick();assert.equal(calls,2);assert.equal(f.lib.status().counts.analyzed,15);assert.equal(f.lib.status().counts.uncertain,0);assert.equal(f.lib.status().counts.queued,0);
  const next=f.restart();f.advance();await next.tick();assert.equal(calls,2);assert.equal(next.status().counts.uncertain,0);assert.equal(next.state.jobs.filter(j=>j.status==='superseded').length,15);
});

test('old-version migration also pauses proven preflight attempts instead of resetting their provenance',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;throw new Error('budget_limit');});f.lib.enqueue('source',{hash:'old-preflight',kind:'file',fileId:'file'});
  f.lib.state.files=[{id:'file',status:'indexed'}];await f.lib.tick();assert.equal(calls,1);assert.equal(f.lib.state.jobs[0].analysisAttempts[0].outcome,'pre_submission_rejected');
  const before=structuredClone(f.lib.state);assert.equal(migrateFullSource(f.lib),false);assert.deepEqual(f.lib.state.jobs,before.jobs);assert.deepEqual(f.lib.state.files,before.files);assert.equal(f.lib.state.analysisVersion,undefined);
});

test('paused legacy migration preserves old lessons but cannot newly apply them',async t=>{
  let adopted=0;const f=fixture(t);f.lib.adopt=async()=>{adopted++;};
  f.lib.state.lessons=[{id:'partial',source:{kind:'file'},summary:'Saved partial result',status:'candidate'}];const lessons=structuredClone(f.lib.state.lessons);
  assert.equal(migrateFullSource(f.lib),false);await assert.rejects(f.lib.applyLesson('partial'),/lesson_requires_full_source_reanalysis/);assert.equal(adopted,0);assert.deepEqual(f.lib.state.lessons,lessons);
  f.lib.state.analysisVersion='full_source_v2';assert.equal(migrateFullSource(f.lib),true);await f.lib.applyLesson('partial');assert.equal(adopted,1);
});
