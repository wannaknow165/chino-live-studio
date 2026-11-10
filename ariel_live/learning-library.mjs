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
    for(const j of this.state.jobs)if(j.status==='processing'){j.status='retry';j.retryAt=now()+60000;j.error='interrupted_request_outcome_unknown';}
    this.busy=false;this.save();
  }
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
    if(sensitive(text))throw new Error('sensitive_content_blocked');
    for(const [index,part] of textChunks(text).entries()){
      const id=hash(source.hash+':'+index+':'+part);if(this.state.jobs.some(j=>j.id===id))continue;
      this.state.jobs.push({id,source,index,text:part,status:'queued',attempts:0,at:this.now(),error:''});
    }
  }
  async ingestFile(f) {
    const full=path.resolve(this.inbox,f.name);
    if(!full.startsWith(path.resolve(this.inbox)+path.sep))throw new Error('invalid_source_path');
    const real=fs.realpathSync(full);if(!real.startsWith(fs.realpathSync(this.inbox)+path.sep))throw new Error('invalid_source_path');
    f.hash=await this.fingerprint(real);
    const duplicate=this.state.files.find(x=>x.id!==f.id&&x.hash===f.hash&&x.status==='indexed');
    if(duplicate){f.status='duplicate';f.duplicateOf=duplicate.id;return;}
    f.status='extracting';this.save();
    const text=TEXT_EXTENSIONS.has(f.ext)?fs.readFileSync(real,'utf8'):await this.extract(real,f);
    const after=fs.statSync(real);if(after.size!==f.size||after.mtimeMs!==f.mtime)throw new Error('file_changed_during_extraction');
    if(text&&typeof text==='object'&&Array.isArray(text.parts)){
      for(const [index,part] of text.parts.entries()){
        const source={kind:'file',fileId:f.id,name:f.name,hash:f.hash},id=hash('visual-v2:'+f.hash+':'+index);
        if(!this.state.jobs.some(j=>j.id===id))this.state.jobs.push({id,source,index,text:part.text||'',images:part.images||[],status:'queued',attempts:0,at:this.now(),error:''});
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
    if(this.busy||!this.state.enabled)return;this.busy=true;
    try {
      this.scan();
      // One local extraction or one AI job at a time; live playback is independent.
      const files=this.state.files.filter(x=>['queued','extracting'].includes(x.status)).slice(0,10);
      if(files.length){for(const f of files){try{await this.ingestFile(f);}catch(e){f.status='failed';f.error=safeError(e);this.event('file_failed',{fileId:f.id});}if(MEDIA_EXTENSIONS.has(f.ext))break;}return;}
      const ready=this.state.jobs.filter(x=>['queued','retry'].includes(x.status)&&(!x.retryAt||x.retryAt<=this.now()));
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
      for(const item of batch){item.status='processing';item.attempts++;}
      this.state.requests=[...recent,this.now()];this.save();
      try {
        const packet=batch.length===1?j:{...j,text:batch.map(item=>`[Source part ${item.index+1}]\n${item.text}`).join('\n\n'),images:batch.flatMap(item=>item.images||[])};
        const r=await this.analyze(packet);
        if(!Array.isArray(r.lines)||!Array.isArray(r.styles))throw new Error('invalid_analysis');
        const answers=r.lines.filter(x=>typeof x.text==='string'&&x.text.trim()&&typeof x.when==='string'&&x.when.trim()).slice(0,6);
        const summary=r.styles.filter(x=>typeof x==='string').join('\n').slice(0,4000);
        if(sensitive(summary+JSON.stringify(answers)))throw new Error('sensitive_content_blocked');
        if(!r.irrelevant&&(summary||answers.length))this.state.lessons.push({id:j.id,source:{...j.source,parts:batch.map(item=>item.index)},summary,answers,skills:r.skills||[],analysisVersion:r.analysisVersion||'legacy_review',at:this.now(),status:'candidate',checks:{structuredOutput:true,evidenceLinked:true,behaviorTested:false,...r.checks},adopted:false});
        for(const item of batch){item.irrelevant=!!r.irrelevant;item.analysisVersion=r.analysisVersion||'legacy_review';item.status='analyzed';item.finishedAt=this.now();item.text='';item.error='';this.event('analysis_completed',{jobId:item.id});}this.state.lastError='';
      }catch(e){for(const item of batch){item.error=safeError(e);item.status=item.attempts>=3?'blocked':'retry';item.retryAt=this.now()+Math.min(3600000,300000*2**item.attempts);this.event('analysis_failed',{jobId:item.id,error:item.error});}this.state.lastError=j.error;}
    }finally{this.busy=false;this.save();}
  }
  async applyLesson(id) {
    if(this.busy)throw new Error('worker_busy');
    const l=this.state.lessons.find(x=>x.id===id);if(!l)throw new Error('lesson_not_found');if(l.adopted)return {duplicate:true};
    if(l.status==='legacy_partial_source')throw new Error('lesson_requires_full_source_reanalysis');
    // Explicit owner action, never triggered by text inside an imported file.
    this.busy=true;
    try{await this.adopt(l);l.adopted=true;l.status='owner_applied';this.event('lesson_applied',{lessonId:id});this.save();return {saved:true};}finally{this.busy=false;}
  }
  outcome(id,{success,note}){
    if(this.busy)throw new Error('worker_busy');
    const l=this.state.lessons.find(x=>x.id===id);
    if(!l?.adopted||typeof success!=='boolean'||typeof note!=='string'||note.trim().length<5||note.length>1000||sensitive(note))throw new Error('invalid_behavior_evidence');
    (l.outcomes??=[]).push({at:this.now(),success,note:note.trim(),source:'operator_observed_not_independently_verified'});
    this.event(success?'behavior_success_reported':'behavior_failure_reported',{lessonId:id});this.save();
  }
  retry(id){if(this.busy)throw new Error('worker_busy');const f=this.state.files.find(x=>x.id===id);if(f&&['failed','unsupported','blocked'].includes(f.status)){f.status='queued';f.error='';}const j=this.state.jobs.find(x=>x.id===id);if(j){j.status='queued';j.retryAt=0;j.attempts=0;}this.save();}
  status(){
    const count=k=>this.state.jobs.filter(j=>j.status===k).length;
    return {inbox:this.inbox,enabled:this.state.enabled,busy:this.busy,lastError:this.state.lastError,
      counts:{files:this.state.files.length,indexed:this.state.files.filter(f=>f.status==='indexed').length,queued:count('queued')+count('retry'),analyzed:count('analyzed'),blocked:count('blocked'),lessons:this.state.lessons.length,applied:this.state.lessons.filter(l=>l.adopted).length,behaviorVerified:0,operatorReportedSuccesses:this.state.lessons.reduce((n,l)=>n+(l.outcomes||[]).filter(x=>x.success).length,0),requestsToday:this.state.requests.filter(t=>t>this.now()-86400000).length},
      files:this.state.files.slice(-200).map(f=>({...f,analysisTotal:this.state.jobs.filter(j=>j.source.fileId===f.id&&j.status!=='superseded').length,analysisDone:this.state.jobs.filter(j=>j.source.fileId===f.id&&j.status==='analyzed').length})),jobs:this.state.jobs.slice(-100).map(({text,...j})=>j),lessons:this.state.lessons.slice(-100),history:this.state.history.slice(-200),limits:{requestsPer24h:48,fileMB:512},meaning:'Analysis is not model-weight training or proven live skill.'};
  }
}
