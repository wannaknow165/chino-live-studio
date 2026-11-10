import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {googleVideoCredential} from './google-video-credentials.mjs';
import {performanceFor} from './chino-performances.mjs';

// The legacy effects server has no importable generator and is edited separately.
// Preserve its model, reference image and voice direction, but own a SINGLE
// request here so an approval cannot silently spend three generation attempts.
const MODEL='gemini-omni-1.2-flash';
const LOOK='The exact same lion king seated on the golden throne, locked-off static camera, same crown, same gold chains, same room and lighting as the image. His face stays identical to the image: both amber eyes sharp, clear, symmetrical and natural, no eye distortion, no warping of the face.';
const VOICE='His voice is always the same: an ultra-deep, gravelly, menacing male bass with vocal fry and a native Israeli accent, slow and confident like a mafia-boss king, with a cynical smirk.';
function videoData(o){if(!o||typeof o!=='object')return null;if(typeof o.output_video?.data==='string')return o.output_video.data;if(o.type==='video'&&typeof o.data==='string')return o.data;for(const v of Object.values(o)){const found=videoData(v);if(found)return found;}return null;}
export class SingleAttemptVideoProvider {
  constructor({root,fetchImpl=fetch,runImpl=promisify(execFile)}){Object.assign(this,{root,fetchImpl,runImpl});}
  openrouterKey(){try{return JSON.parse(fs.readFileSync(path.join(this.root,'data/settings.json'),'utf8')).openrouterKey||'';}catch{return '';}}
  key(){const stored=googleVideoCredential();if(stored)return stored;for(const f of [path.join(this.root,'.env'),path.join(this.root,'..','.env')]){try{const m=fs.readFileSync(f,'utf8').match(/^GEMINI_API_KEY=(\S+)/m);if(m)return m[1];}catch{}}return process.env.GEMINI_API_KEY||'';}
  preflight(){if(!this.openrouterKey()&&!this.key())throw new Error('generation_key_missing');if(!fs.existsSync(path.join(this.root,'media','master.png')))throw new Error('generation_reference_missing');}
  async generate(job){
    this.preflight();const img=fs.readFileSync(path.join(this.root,'media','master.png')).toString('base64');
    const performance=performanceFor(job.performanceId);
    const motion=performance?.motion||'Only tiny head and paw movements. Both paws rest on the golden armrests.';
    const prompt=performance?.silent?`${LOOK} ${motion} No speech, vocalizations, music or sound effects. The complete performance lasts ${performance.seconds} seconds. Return to the exact reference pose at the end.`:`${LOOK} ${VOICE} He speaks directly to the camera, in the language of the supplied line, with natural lips synchronized to every syllable. ${motion} Keep identity, mane, crown and chains consistent. Say exactly this literal line, nothing else: ${JSON.stringify(job.text)}. No music, sound effects, subtitles or text. Return to the reference pose at the end. ${performance?`The complete performance lasts ${performance.seconds} seconds.`:'Keep the clip as short as needed for the line, never more than 15 seconds.'}`;
    const seconds=performance?.seconds||Math.min(15,Math.max(3,Math.ceil(job.text.split(/\s+/).length/1.9)+1));
    job.requestedSeconds=seconds;
    if(this.openrouterKey())return this.generateOpenRouter(job,{prompt,seconds});
    let r;try{r=await this.fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers:{'x-goog-api-key':this.key(),'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,store:false,background:false,stream:false,input:[{type:'image',data:img,mime_type:'image/png'},{type:'text',text:prompt}],response_format:{type:'video',aspect_ratio:'9:16',resolution:'720p',duration:seconds+'s'}}),signal:AbortSignal.timeout(300000)});}catch{throw new Error('generation_submission_uncertain');}
    if(!r.ok){let error,raw='';try{raw=await r.text();try{error=JSON.parse(raw).error;}catch{}}catch{}job.providerFailure={httpStatus:r.status,status:/^[A-Z_]+$/.test(error?.status||'')?error.status:'',message:String(error?.message||raw||'').replaceAll(this.key(),'[redacted]').replace(/[A-Za-z0-9_+\/-]{40,}/g,'[redacted]').slice(0,400)};if(r.status===429)throw new Error('generation_rate_or_quota');if([401,403].includes(r.status))throw new Error('generation_auth_failed');throw new Error('generation_http_'+r.status);}
    const j=await r.json(),encoded=videoData(j);if(!encoded)throw new Error('generation_no_video');
    const id='chino-'+crypto.randomUUID(),file=id+'.mp4';fs.mkdirSync(path.join(this.root,'media','generated'),{recursive:true});fs.writeFileSync(path.join(this.root,'media','generated',file),Buffer.from(encoded,'base64'));
    return {id,file,text:job.text,created:Date.now(),model:MODEL,attempts:1,usage:j.usage||null};
  }
  async generateOpenRouter(job,{prompt,seconds}){
    const key=this.openrouterKey(),model='google/gemini-omni-1.2-flash',dir=path.join(this.root,'data/video-director');fs.mkdirSync(dir,{recursive:true});
    const response=await this.fetchImpl('https://openrouter.ai/api/v1/videos/models',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('generation_catalog_unavailable');const catalog=await response.json(),m=catalog.data?.find(x=>x.id===model),rate=Number(m?.pricing_skus?.duration_seconds_with_audio_720p);
    if(!m?.supported_durations?.includes(seconds)||!m.supported_frame_images?.includes('first_frame')||!Number.isFinite(rate)||rate*seconds>1.05)throw new Error('generation_price_or_capability_changed');
    const id='chino-'+(job.id||crypto.randomUUID()),audit=path.join(dir,'openrouter-'+id+'.json');
    if(fs.existsSync(audit))throw new Error('generation_submission_uncertain');
    fs.writeFileSync(audit,JSON.stringify({state:'submitting',model,seconds,maxAttempts:1,estimatedVideoUSD:rate*seconds,limitUSD:1.15,created:Date.now()},null,2),{flag:'wx'});
    const args=[path.join(this.root,'tools/or_video.py'),path.join(this.root,'media/master.png'),id,model,String(seconds),'720p','--aspect=9:16','--job-state-file='+audit,'--prompt='+prompt,...(performanceFor(job.performanceId)?.silent?[]:['--audio']),...(m.supported_frame_images.includes('last_frame')?['--last-frame='+path.join(this.root,'media/master.png')]:[])];
    let out;try{out=await this.runImpl('python',args,{cwd:this.root,windowsHide:true,timeout:300000,maxBuffer:1024*1024});}catch{throw new Error('generation_submission_uncertain');}
    let result;try{result=JSON.parse(out.stdout.trim().split(/\r?\n/).at(-1));}catch{throw new Error('generation_submission_uncertain');}
    if(result.error){const message=String(result.error).replaceAll(key,'[redacted]').replace(/(?:sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{25,}|AQ\.[A-Za-z0-9_-]{30,})/g,'[redacted]');const status=Number(/HTTP (\d+)/.exec(message)?.[1]||0);job.providerFailure={httpStatus:status,message:message.slice(0,400),provider:'openrouter'};throw new Error(status===402?'generation_http_402':status===429?'generation_rate_or_quota':[401,403].includes(status)?'generation_auth_failed':status?'generation_http_'+status:'generation_provider_failed');}
    const source=path.join(this.root,'data/ovsrc',id+'.mp4');if(path.resolve(result.video||'')!==source||!fs.existsSync(source))throw new Error('generation_output_missing');
    const file=id+'.mp4';fs.mkdirSync(path.join(this.root,'media/generated'),{recursive:true});fs.copyFileSync(source,path.join(this.root,'media/generated',file),fs.constants.COPYFILE_EXCL);
    return {id,file,text:job.text,created:Date.now(),model,provider:'openrouter',attempts:1,usage:{cost:result.cost},providerJobId:result.id};
  }

}
