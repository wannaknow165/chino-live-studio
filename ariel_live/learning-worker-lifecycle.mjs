import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Ownership must be established before reading/mutating library state. Existing
// locks (including stale/malformed ones) require explicit reconciliation; never
// race an unlink/recreate sequence against another starting worker.
export function acquireWorkerLock(directory){
  const lock=path.join(directory,'worker.lock'),token=randomUUID();
  let fd;
  try{fd=fs.openSync(lock,'wx',0o600);}
  catch(e){if(e.code==='EEXIST')throw new Error('learning_worker_lock_requires_reconciliation');throw e;}
  try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,token}));fs.fsyncSync(fd);}
  catch(e){fs.closeSync(fd);throw e;} // Leave a failed/partial claim in place.
  let released=false;
  return ()=>{
    if(released)return;released=true;
    try{
      const current=JSON.parse(fs.readFileSync(lock,'utf8'));
      if(current.pid===process.pid&&current.token===token)fs.unlinkSync(lock);
    }catch{}finally{try{fs.closeSync(fd);}catch{}}
  };
}

// Called only after HTTP listen succeeds; a port failure must never submit work.
export function createWorkerScheduling(runner,{schedule=setInterval,cancel=clearInterval}={}){
  let timer=null,started=false,stopped=false;
  return {
    start(){
      if(started||stopped||runner.stopping)return;
      started=true;timer=schedule(()=>runner.cycle(),15000);runner.cycle();
    },
    stop(){stopped=true;if(timer!==null)cancel(timer);timer=null;}
  };
}

// Shared by the real worker and no-network lifecycle regressions.
export function migrateFullSource(library){
  library.migrationReady=false;library.reconcileAttempts();
  if(library.state.analysisVersion==='full_source_v2'){library.migrationReady=true;return true;}
  const completed=library.state.jobs.some(j=>j.status==='analyzed'||j.supersededFrom==='analyzed'||j.finishedAt||j.analysisVersion||j.analysisAttempts?.some(a=>a.outcome==='completed'))||library.state.lessons.some(l=>l.source?.kind==='file');
  const attempted=library.state.jobs.some(j=>j.attempts>0||j.requestId||j.requestStartedAt||j.error||j.analysisAttempts?.length)||library.state.history.some(e=>e.kind?.startsWith('analysis_'));
  if(completed||attempted||library.state.jobs.some(j=>j.status==='uncertain')){
    library.state.lastError='analysis_migration_requires_reconciliation';
    library.save();return false;
  }
  // Previous file jobs clipped text to 500 characters. Preserve the old audit
  // trail, but never automatically pay again for an already-completed source
  // or run this migration across an unresolved provider outcome.
  for(const f of library.state.files)if(f.status==='indexed'){
    f.status='queued';
    for(const j of library.state.jobs.filter(j=>j.source.fileId===f.id)){j.supersededFrom=j.status;j.status='superseded';}
  }
  for(const l of library.state.lessons)if(l.source.kind==='file')l.status='legacy_partial_source';
  for(const j of library.state.jobs)if(j.status==='superseded'){
    // Freeze the old alias evidence before reusing the original ID. New
    // completion events must not turn the archived untouched job uncertain.
    j.legacyEventHistory??=library.state.history.filter(e=>e.jobId===j.id||e.jobId===j.id.replace(/^(legacy-)+/,''));
    j.id='legacy-'+j.id;
  }
  library.state.analysisVersion='full_source_v2';library.save();library.migrationReady=true;return true;
}

export function createLearningRunner({library,migrationReady,importSource}){
  let stopping=false,active=null,shutdownPromise=null;
  return {
    get stopping(){return stopping;},
    cycle(){
      if(stopping||!migrationReady||active||library.busy)return active||Promise.resolve();
      active=(async()=>{
        try{await importSource();if(!stopping)await library.tick();}
        catch{library.state.lastError='worker_cycle_failed';library.save();}
        finally{active=null;}
      })();
      return active;
    },
    shutdown({stopScheduling,closeServer,stopTranscriber,exit}){
      if(shutdownPromise)return shutdownPromise;
      // Admission stops synchronously before any awaited cleanup.
      stopping=true;stopScheduling();
      const drained=library.stop();
      shutdownPromise=(async()=>{
        await Promise.all([active,drained,closeServer()]);
        // Extraction may still need the transcriber until its tick completes.
        stopTranscriber();exit();
      })();
      return shutdownPromise;
    }
  };
}
