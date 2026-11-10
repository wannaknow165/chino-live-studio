import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createInterface} from 'node:readline';

export const TEXT_EXTENSIONS = new Set(['.txt','.md','.csv','.json','.jsonl','.srt','.vtt']);
export const MEDIA_EXTENSIONS = new Set(['.mp4','.webm','.mov','.mkv','.mp3','.wav','.m4a','.ogg']);
const DOCUMENT_EXTENSIONS = new Set(['.pdf','.docx','.pptx','.png','.jpg','.jpeg','.webp']);
const MAX_FILE = 512 * 1024 * 1024;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const safeError = e => /^[a-z0-9_]{1,90}$/.test(e?.message||'') ? e.message : 'processing_failed';
// Only these exact local preflight errors prove that no provider request was sent.
// A timeout, connection loss, incomplete result or crash may already have cost money.
const PRE_SUBMISSION_ERRORS = new Set(['openai_key_required','local_rate_limit','budget_limit']);
const uncertainJob = j => j.status === 'uncertain' || j.error === 'interrupted_request_outcome_unknown';
const retryableStatus = j => ['queued','retry','blocked'].includes(j.status);
function priorEvents(state,j) {
  // Old migration renamed job IDs without updating the audit history.
  if(Array.isArray(j.legacyEventHistory))return [...j.legacyEventHistory,...(state.history||[]).filter(e=>e.jobId===j.id)];
  const original=j.id.replace(/^(legacy-)+/,'');
  return (state.history||[]).filter(e=>e.jobId===j.id||e.jobId===original);
}
function ambiguousAttempt(state,j) {
  const events=priorEvents(state,j);
  if(uncertainJob(j)||j.status==='processing')return true;
  if(events.some(e=>e.kind==='analysis_uncertain'||(e.kind==='analysis_failed'&&!PRE_SUBMISSION_ERRORS.has(e.error))))return true;
  const journal=j.attemptLogVersion===1&&Array.isArray(j.analysisAttempts)?j.analysisAttempts:null;
  if(journal?.some(a=>!a||!a.requestId||!['pre_submission_rejected','completed'].includes(a.outcome)||(a.outcome==='pre_submission_rejected'&&!PRE_SUBMISSION_ERRORS.has(a.error))))return true;
  if(journal&&j.attempts>journal.length)return true;
  if(!retryableStatus(j)&&(j.status!=='superseded'||j.supersededFrom==='analyzed'))return false;
  if(j.error&&!PRE_SUBMISSION_ERRORS.has(j.error))return true;
  const attempted=j.attempts>0||j.error||j.requestId||j.requestStartedAt||j.finishedAt||j.analysisVersion||events.some(e=>e.kind.startsWith('analysis_'));
  // Legacy event history is truncated and manual retry reset its counter. A safe
  // latest error cannot prove that an older request never reached the provider.
  if(!journal)return !!attempted;
  if(retryableStatus(j)&&journal.some(a=>a.outcome!=='pre_submission_rejected'))return true;
  return !!attempted&&!journal.length;
}
const sameSource=(a,b)=>!!(a&&b&&((a.hash&&a.hash===b.hash)||(a.fileId&&a.fileId===b.fileId)||(a.liveId&&a.liveId===b.liveId)));

export function textChunks(text, size=4000) {
  const value=String(text).replace(/\u0000/g,'').trim(), out=[];
  for(let i=0;i<value.length;i+=size)out.push(value.slice(i,i+size));
  return out;
}
export function sensitive(text) {return /(?:sk-(?:proj-|or-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{25,}|AQ\.[A-Za-z0-9_-]{30,}|-----BEGIN .*PRIVATE KEY)/.test(text);}
export class LearningLibrary {
  constructor({directory,inbox,analyze,extract,adopt,now=Date.now}) {
    Object.assign(this,{directory,inbox,analyze,extract,adopt,now});
    fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(inbox,{recursive:true});
    this.file=path.join(directory,'library.json');
    this.state=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,enabled:true,files:[],jobs:[],lessons:[],history:[],liveSeen:[],requests:[],lastError:''};
    this.busy=false;this.stopping=false;this.idleWaiters=[];
    this.reconcileAttempts();this.save();
  }
  reconcileAttempts(){
    for(const j of this.state.jobs){
      if(ambiguousAttempt(this.state,j)){
        const interrupted=j.status==='processing';
        j.quarantinedFrom??=j.status;j.status='uncertain';
        if(interrupted)j.error='interrupted_request_outcome_unknown';
        else if(!j.error)j.error='analysis_outcome_unknown';
        j.uncertainAt??=this.now();delete j.retryAt;
        this.state.lastError='analysis_outcome_requires_reconciliation';
      }else if(!j.attempts&&!j.error&&!j.requestId&&retryableStatus(j)&&!j.analysisAttempts){
        j.attemptLogVersion=1;j.analysisAttempts=[];
      }
    }
  }
  sourceUncertain(source){return this.state.jobs.some(j=>uncertainJob(j)&&sameSource(source,j.source));}
  stop(){this.stopping=true;return this.busy?new Promise(resolve=>this.idleWaiters.push(resolve)):Promise.resolve();}
  finishWork(){this.busy=false;for(const resolve of this.idleWaiters.splice(0))resolve();}

  save(){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.state));fs.renameSync(this.file+'.tmp',this.file);}
  event(kind,detail={}) {this.state.history.push({at:this.now(),kind,...detail});this.state.history=this.state.history.slice(-2000);}
  scan() {
    const walk=dir=>{for(const d of fs.readdirSync(dir,{withFileTypes:true})){
      if(d.isSymbolicLink())continue;const p=path.join(dir,d.name);
      if(d.isDirectory()){walk(p);continue;}if(!d.isFile()||d.name.startsWith('.'))continue;
      const stat=fs.statSync(p),rel=path.relative(this.inbox,p);
      if(this.now()-stat.mtimeMs<5000)continue;
      const prior=this.state.files.find(x=>x.name===rel&&x.size===stat.size&&x.mtime===stat.mtimeMs);if(prior)continue;
      const ext=path.extname(p).toLowerCase();
      const f={id:crypto.randomUUID(),name:rel,size:stat.size,mtime:stat.mtimeMs,at:this.now(),status:'queued',ext,error:''};
      if(stat.size>MAX_FILE){f.status='blocked';f.error='file_exceeds_512mb';}
      else if(!TEXT_EXTENSIONS.has(ext)&&!MEDIA_EXTENSIONS.has(ext)&&!DOCUMENT_EXTENSIONS.has(ext)){f.status='unsupported';f.error='unsupported_file_type';}
      this.state.files.push(f);this.event('file_detected',{fileId:f.id});
    }};walk(this.inbox);this.save();
  }
  async fingerprint(file) {
    const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');
  }
  enqueue(text,source) {
    if(this.sourceUncertain(source))throw new Error('analysis_source_requires_reconciliation');
    if(sensitive(text))throw new Error('sensitive_content_blocked');
    for(const [index,part] of textChunks(text).entries()){
      const id=hash(source.hash+':'+index+':'+part);if(this.state.jobs.some(j=>j.id===id))continue;
      this.state.jobs.push({id,source,index,text:part,status:'queued',attempts:0,attemptLogVersion:1,analysisAttempts:[],at:this.now(),error:''});
    }
  }
  async ingestFile(f) {
    const full=path.resolve(this.inbox,f.name);
    if(!full.startsWith(path.resolve(this.inbox)+path.sep))throw new Error('invalid_source_path');
    const real=fs.realpathSync(full);if(!real.startsWith(fs.realpathSync(this.inbox)+path.sep))throw new Error('invalid_source_path');
    f.hash=await this.fingerprint(real);
    if(this.sourceUncertain({fileId:f.id,hash:f.hash}))throw new Error('analysis_source_requires_reconciliation');
    const duplicate=this.state.files.find(x=>x.id!==f.id&&x.hash===f.hash&&x.status==='indexed');
    if(duplicate){f.status='duplicate';f.duplicateOf=duplicate.id;return;}
    f.status='extracting';this.save();
    const text=TEXT_EXTENSIONS.has(f.ext)?fs.readFileSync(real,'utf8'):await this.extract(real,f);
    const after=fs.statSync(real);if(after.size!==f.size||after.mtimeMs!==f.mtime)throw new Error('file_changed_during_extraction');
    if(text&&typeof text==='object'&&Array.isArray(text.parts)){
      for(const [index,part] of text.parts.entries()){
        const source={kind:'file',fileId:f.id,name:f.name,hash:f.hash},id=hash('visual-v2:'+f.hash+':'+index);
        if(!this.state.jobs.some(j=>j.id===id))this.state.jobs.push({id,source,index,text:part.text||'',images:part.images||[],status:'queued',attempts:0,attemptLogVersion:1,analysisAttempts:[],at:this.now(),error:''});
      }
      f.status='indexed';f.visualParts=text.parts.length;this.event('file_indexed',{fileId:f.id});return;
    }
    if(!String(text).trim())throw new Error('no_extractable_text');
    if(String(text).length>5_000_000)throw new Error('extracted_text_exceeds_limit');
    this.enqueue(text,{kind:'file',fileId:f.id,name:f.name,hash:f.hash});
    f.status='indexed';f.characters=text.length;this.event('file_indexed',{fileId:f.id});
  }
  async importLive(file) {
    if(!fs.existsSync(file))return;
    const lines=createInterface({input:fs.createReadStream(file),crlfDelay:Infinity});
    let imported=0;
    for await(const line of lines){
      let r;try{r=JSON.parse(line);}catch{continue;}
      if(r.kind!=='analysis_candidate'||!r.id||this.state.liveSeen.includes(r.id))continue;
      if(this.state.jobs.some(j=>j.source.liveId===r.id)){this.state.liveSeen.push(r.id);continue;}
      // Evidence-linked live analysis is retained as an unverified source, never as a proven policy.
      this.enqueue(JSON.stringify({summary:r.styles,answers:r.lines,battle:r.battle,chat:r.chat}),{kind:'live',liveId:r.id,name:r.src||'unknown',hash:r.id});
      this.state.liveSeen.push(r.id);if(++imported>=20)break;
    }
    this.save();
  }
  async tick() {
    if(this.busy||this.stopping||!this.state.enabled)return;this.busy=true;
    try {
      this.reconcileAttempts();this.scan();
      // One local extraction or one AI job at a time; live playback is independent.
      const files=this.state.files.filter(x=>['queued','extracting'].includes(x.status)).slice(0,10);
      if(files.length){for(const f of files){try{await this.ingestFile(f);}catch(e){f.status='failed';f.error=safeError(e);this.event('file_failed',{fileId:f.id});}if(MEDIA_EXTENSIONS.has(f.ext))break;}return;}
      const ready=this.state.jobs.filter(x=>['queued','retry'].includes(x.status)&&!this.sourceUncertain(x.source)&&Math.max(x.attempts,x.analysisAttempts?.length||0)<3&&(!x.retryAt||x.retryAt<=this.now()));
      const priority=j=>/Reports[\\/]|Quizzes[\\/]|Flashcards[\\/]/i.test(j.source.name||'')?0:/contact|privacy|terms|sign.?in|signup|membership/i.test(j.source.name||'')?3:1;
      ready.sort((a,b)=>priority(a)-priority(b));
      const j=ready.find(x=>x.source.kind==='file')||ready[0];
      if(!j)return;
      // Throttle continuous learning; all requests also use the director's existing persistent dollar ceiling.
      const recent=this.state.requests.filter(t=>t>this.now()-86400000);
      if(recent.length>=48){this.state.lastError='daily_request_limit';return;}
      if(recent.some(t=>t>this.now()-60000))return;
      const batch=[j];let chars=j.text.length,images=(j.images||[]).length;
      for(const other of ready){if(other===j||batch.length>=12||j.source.kind!=='file'||other.source.hash!==j.source.hash)continue;const nextImages=(other.images||[]).length;if(chars+other.text.length+100>60000||images+nextImages>4)continue;batch.push(other);chars+=other.text.length+100;images+=nextImages;}
      // Local audit identity only. The director/provider does not receive or
      // enforce this ID, so it provides NO provider-side idempotency guarantee.
      const requestId=crypto.randomUUID();
      for(const item of batch){
        item.status='processing';item.attempts++;item.requestId=requestId;item.requestStartedAt=this.now();
        item.attemptLogVersion=1;(item.analysisAttempts??=[]).push({requestId,startedAt:this.now(),outcome:'pending'});
      }
      this.state.requests=[...recent,this.now()];this.save();
      try {
        const packet=batch.length===1?j:{...j,text:batch.map(item=>`[Source part ${item.index+1}]\n${item.text}`).join('\n\n'),images:batch.flatMap(item=>item.images||[])};
        const r=await this.analyze(packet);
        if(!Array.isArray(r.lines)||!Array.isArray(r.styles))throw new Error('invalid_analysis');
        const answers=r.lines.filter(x=>typeof x.text==='string'&&x.text.trim()&&typeof x.when==='string'&&x.when.trim()).slice(0,6);
        const summary=r.styles.filter(x=>typeof x==='string').join('\n').slice(0,4000);
        if(sensitive(summary+JSON.stringify(answers)))throw new Error('sensitive_content_blocked');
        if(!r.irrelevant&&(summary||answers.length))this.state.lessons.push({id:j.id,source:{...j.source,parts:batch.map(item=>item.index)},summary,answers,skills:r.skills||[],analysisVersion:r.analysisVersion||'legacy_review',at:this.now(),status:'candidate',checks:{structuredOutput:true,evidenceLinked:true,behaviorTested:false,...r.checks},adopted:false});
        for(const item of batch){Object.assign(item.analysisAttempts.at(-1),{outcome:'completed',finishedAt:this.now()});item.irrelevant=!!r.irrelevant;item.analysisVersion=r.analysisVersion||'legacy_review';item.status='analyzed';item.finishedAt=this.now();item.text='';item.error='';this.event('analysis_completed',{jobId:item.id});}this.state.lastError='';
      }catch(e){
        const error=safeError(e),safeToRetry=PRE_SUBMISSION_ERRORS.has(error);
        for(const item of batch){
          item.error=error;
          Object.assign(item.analysisAttempts.at(-1),{outcome:safeToRetry?'pre_submission_rejected':'uncertain',error,finishedAt:this.now()});
          if(safeToRetry){item.status=item.attempts>=3?'blocked':'retry';item.retryAt=this.now()+Math.min(3600000,300000*2**item.attempts);}
          else{item.status='uncertain';item.uncertainAt=this.now();delete item.retryAt;}
          this.event(safeToRetry?'analysis_failed':'analysis_uncertain',{jobId:item.id,requestId:item.requestId,error:item.error});
        }
        this.state.lastError=safeToRetry?j.error:'analysis_outcome_requires_reconciliation';
      }
    }finally{try{this.save();}finally{this.finishWork();}}
  }
  async applyLesson(id) {
    if(this.stopping)throw new Error('worker_stopping');
    if(this.busy)throw new Error('worker_busy');
    const l=this.state.lessons.find(x=>x.id===id);if(!l)throw new Error('lesson_not_found');if(l.adopted)return {duplicate:true};
    if(l.status==='legacy_partial_source'||(this.migrationReady===false&&l.source.kind==='file'))throw new Error('lesson_requires_full_source_reanalysis');
    // Explicit owner action, never triggered by text inside an imported file.
    this.busy=true;
    try{await this.adopt(l);l.adopted=true;l.status='owner_applied';this.event('lesson_applied',{lessonId:id});this.save();return {saved:true};}finally{this.finishWork();}
  }
  outcome(id,{success,note}){
    if(this.stopping)throw new Error('worker_stopping');
    if(this.busy)throw new Error('worker_busy');
    const l=this.state.lessons.find(x=>x.id===id);
    if(!l?.adopted||typeof success!=='boolean'||typeof note!=='string'||note.trim().length<5||note.length>1000||sensitive(note))throw new Error('invalid_behavior_evidence');
    (l.outcomes??=[]).push({at:this.now(),success,note:note.trim(),source:'operator_observed_not_independently_verified'});
    this.event(success?'behavior_success_reported':'behavior_failure_reported',{lessonId:id});this.save();
  }
  retry(id){
    if(this.stopping)throw new Error('worker_stopping');
    if(this.busy)throw new Error('worker_busy');
    const j=this.state.jobs.find(x=>x.id===id);
    if(j){
      this.reconcileAttempts();
      if(uncertainJob(j)||this.sourceUncertain(j.source)){this.save();throw new Error('analysis_outcome_requires_reconciliation');}
      if(!['retry','blocked'].includes(j.status)||!PRE_SUBMISSION_ERRORS.has(j.error))throw new Error('analysis_retry_not_safe');
      if(Math.max(j.attempts,j.analysisAttempts?.length||0)>=3)throw new Error('analysis_retry_limit');
      j.status='queued';j.retryAt=0;
    }
    const f=this.state.files.find(x=>x.id===id);
    if(f&&this.sourceUncertain({fileId:f.id,hash:f.hash}))throw new Error('analysis_outcome_requires_reconciliation');
    if(f&&['failed','unsupported','blocked'].includes(f.status)){f.status='queued';f.error='';}
    this.save();
  }
  status(){
    const count=k=>this.state.jobs.filter(j=>j.status===k).length;
    return {inbox:this.inbox,enabled:this.state.enabled,busy:this.busy,lastError:this.state.lastError,
      counts:{files:this.state.files.length,indexed:this.state.files.filter(f=>f.status==='indexed').length,queued:count('queued')+count('retry'),analyzed:count('analyzed'),blocked:count('blocked'),uncertain:count('uncertain'),lessons:this.state.lessons.length,applied:this.state.lessons.filter(l=>l.adopted).length,behaviorVerified:0,operatorReportedSuccesses:this.state.lessons.reduce((n,l)=>n+(l.outcomes||[]).filter(x=>x.success).length,0),requestsToday:this.state.requests.filter(t=>t>this.now()-86400000).length},
      files:this.state.files.slice(-200).map(f=>({...f,analysisTotal:this.state.jobs.filter(j=>j.source.fileId===f.id&&j.status!=='superseded').length,analysisDone:this.state.jobs.filter(j=>j.source.fileId===f.id&&j.status==='analyzed').length})),jobs:this.state.jobs.slice(-100).map(({text,...j})=>j),lessons:this.state.lessons.slice(-100),history:this.state.history.slice(-200),limits:{requestsPer24h:48,fileMB:512},meaning:'Analysis is not model-weight training or proven live skill.'};
  }
}
