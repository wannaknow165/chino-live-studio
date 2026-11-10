import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {LearningLibrary,MEDIA_EXTENSIONS} from './learning-library.mjs';
import {LocalTranscriber} from './local-transcriber.mjs';
import {migrateFullSource,createLearningRunner,acquireWorkerLock,createWorkerScheduling} from './learning-worker-lifecycle.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const directory=process.env.CHINO_LEARNING_HOME||path.join(os.homedir(),'CHINO-Learning');
const inbox=path.join(directory,'Inbox'),port=Number(process.env.CHINO_LEARNING_PORT||7781);
let notebook={url:'https://notebook.google.com/',status:'not_configured',connected:false,lastSyncAt:null};
try{const saved=JSON.parse(fs.readFileSync(path.join(directory,'notebook.json'),'utf8'));const u=new URL(saved.url);if(['notebook.google.com','notebooklm.google.com'].includes(u.hostname)&&u.protocol==='https:')notebook={...notebook,url:u.href,status:'awaiting_authenticated_connection'};}catch{}
fs.mkdirSync(directory,{recursive:true});
const release=acquireWorkerLock(directory);
process.on('exit',release);
const run=promisify(execFile),python=path.join(root,'.venv-learning',process.platform==='win32'?'Scripts/python.exe':'bin/python');
let transcriber=null,ffmpeg='';
async function mediaTool(){if(!ffmpeg){try{const {stdout}=await run(python,['-c','import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],{windowsHide:true});ffmpeg=stdout.trim();}catch{await run('ffmpeg',['-version'],{windowsHide:true});ffmpeg='ffmpeg';}}return ffmpeg;}
async function imageData(file){
  const tool=await mediaTool();
  const {stdout}=await run(tool,['-hide_banner','-loglevel','error','-nostdin','-i',file,'-vf','scale=1280:1280:force_original_aspect_ratio=decrease','-frames:v','1','-q:v','4','-f','image2pipe','-c:v','mjpeg','pipe:1'],{windowsHide:true,timeout:30000,maxBuffer:600000,encoding:'buffer'});
  return 'data:image/jpeg;base64,'+stdout.toString('base64');
}
async function extract(file,info){
  if(['.png','.jpg','.jpeg','.webp'].includes(info.ext))return {parts:[{text:'Learning infographic; distinguish observed text from inference.',images:[file]}]};
  if(!MEDIA_EXTENSIONS.has(info.ext)){
    const {stdout}=await run(python,[path.join(root,'tools','extract-learning-document.py'),file,path.join(directory,'cache',info.hash)],{windowsHide:true,timeout:180000,maxBuffer:25_000_000});
    const j=JSON.parse(stdout);if(j.error)throw new Error(j.error);return j.parts?j:j.text;
  }
  if(!transcriber){const cfg=JSON.parse(fs.readFileSync(path.join(root,'data','local-transcription-config.json'),'utf8'));if(!cfg.model)throw new Error('local_transcription_not_configured');transcriber=new LocalTranscriber(python,[path.join(root,'tools','transcribe_local.py'),cfg.model],120000);}
  await mediaTool();
  const tmp=fs.mkdtempSync(path.join(directory,'audio-'));
  try{
    await run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i',file,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','libmp3lame','-b:a','48k','-f','segment','-segment_time','30','-reset_timestamps','1',path.join(tmp,'%06d.mp3')],{windowsHide:true,timeout:1800000,maxBuffer:1000000});
    const parts=fs.readdirSync(tmp).filter(x=>x.endsWith('.mp3')).sort();let text='';
    if(parts.length>720)throw new Error('media_exceeds_six_hours');
    for(const [index,name] of parts.entries()){
      const r=await transcriber.transcribe(fs.readFileSync(path.join(tmp,name)).toString('base64'));
      text+=r.lines.map(x=>`[${index*30+(x.start||0)}s] ${x.text}`).join('\n')+'\n';
      info.extractionProgress={completed:index+1,total:parts.length};library.save();
    }
    return text;
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
async function director(route,body){
  const r=await fetch('http://127.0.0.1:7780'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  const j=await r.json();if(!r.ok)throw new Error(/^[a-z0-9_]+$/.test(j.error||'')?j.error:'director_unavailable');return j;
}
const library=new LearningLibrary({directory,inbox,extract,
  analyze:async j=>director('/api/director/learning/analyze',{text:j.text,images:await Promise.all((j.images||[]).map(imageData))}),
  adopt:l=>director('/api/director/operator',{id:'learning-'+l.id,mode:'teach',text:('חומר לימוד שהמפעיל בחר להחיל; עדיין לא הוכחת הצלחה בלייב.\n'+l.summary.slice(0,400)+'\n'+(l.skills?.length?l.skills.map(x=>x.policy).join('\n'):l.answers.map(x=>`${x.when}: ${x.text}`).join('\n'))).slice(0,1700)})
});
// Fail closed before the legacy migration can supersede quarantined jobs.
const migrationReady=migrateFullSource(library);
const runner=createLearningRunner({library,migrationReady,
  importSource:()=>library.importLive(path.join(root,'data','learning','observations.jsonl'))});
const scheduling=createWorkerScheduling(runner);
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
const server=http.createServer(async(req,res)=>{
  try{
    if(runner.stopping)return json(res,{error:'worker_stopping'},503);
    // Local UI only. Reject cross-site mutation attempts and DNS rebinding.
    if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host))return json(res,{error:'invalid_host'},403);
    if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync(path.join(root,'public','learning.html')));return;}
    if(req.method==='GET'&&req.url==='/api/status'){
      let evaluation=null;try{const r=await fetch('http://127.0.0.1:7780/api/director/evaluation',{signal:AbortSignal.timeout(1500)});if(r.ok){const e=await r.json();evaluation={running:!!e.running,startedAt:e.startedAt,finishedAt:e.finishedAt,total:e.total,completed:e.completed,passed:e.passed??(e.results||[]).filter(x=>x.passed).length,error:e.error,kind:e.kind};}}catch{}
      return json(res,{...library.status(),notebook,evaluation});
    }
    if(req.method!=='POST')return json(res,{error:'not_found'},404);
    if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return json(res,{error:'invalid_origin'},403);
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,{error:'json_required'},415);
    let body='';for await(const chunk of req){body+=chunk;if(body.length>20000)return json(res,{error:'request_too_large'},413);}
    const b=JSON.parse(body||'{}');
    if(req.url==='/api/enabled'){library.state.enabled=!!b.enabled;library.save();return json(res,{enabled:library.state.enabled});}
    if(req.url==='/api/retry'){library.retry(b.id);return json(res,{queued:true});}
    if(req.url==='/api/apply')return json(res,await library.applyLesson(b.id));
    if(req.url==='/api/outcome'){library.outcome(b.id,b);return json(res,{saved:true});}
    if(req.url==='/api/scan'){if(!library.busy)library.scan();return json(res,{scanned:!library.busy});}
    return json(res,{error:'not_found'},404);
  }catch(e){json(res,{error:/^[a-z0-9_]+$/.test(e.message||'')?e.message:'operation_failed'},400);}
});
server.listen(port,'127.0.0.1',()=>{scheduling.start();console.log(`Learning library: http://127.0.0.1:${port} | Inbox: ${inbox}`);});
const shutdown=code=>runner.shutdown({
  stopScheduling:()=>scheduling.stop(),
  closeServer:()=>new Promise(resolve=>server.close(resolve)),
  stopTranscriber:()=>transcriber?.stop(),
  exit:()=>process.exit(code)
}).catch(()=>{console.error('learning_worker_shutdown_failed');process.exit(1);});
server.on('error',()=>shutdown(1));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>shutdown(0));
