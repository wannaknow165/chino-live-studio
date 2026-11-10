import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtureRoot=path.join(root,'test-fixtures','speech');
const fixtures=JSON.parse(fs.readFileSync(path.join(fixtureRoot,'manifest.json'),'utf8'));
const base='http://127.0.0.1:7780';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body){const r=await fetch(base+'/api/director/'+route,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(40000)});const j=await r.json();if(!r.ok)throw new Error(/^[a-z0-9_]+$/.test(j.error||'')?j.error:'practice_audio_request_failed');return j;}
const initial=await api('status');if(initial.live?.active||initial.active||initial.busy)throw new Error('rehearsal_requires_idle');
const id=crypto.randomUUID(),file=path.join(root,'data','video-director',`audio-rehearsal-${id}.json`);
const report={id,startedAt:Date.now(),inputSource:'synthetic_recording',actualMicrophoneTested:false,publicBroadcastStarted:false,newVideoGenerationEnabled:false,results:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
const compact=s=>String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
save();
try{
 await api('input/practice',{});
 for(const f of fixtures){
  const state=await api('status');if(state.live?.active)throw new Error('public_mode_changed_during_rehearsal');
  const mode=state.stage?.ready?'auto':'rehearsal';if(state.mode!==mode)await api('mode',{mode});
  const fixturePath=path.resolve(fixtureRoot,f.file);if(!fixturePath.startsWith(fixtureRoot+path.sep))throw new Error('invalid_fixture_path');
  const bytes=fs.readFileSync(fixturePath),hash=crypto.createHash('sha256').update(bytes).digest('hex');if(hash!==f.sha256)throw new Error('practice_fixture_changed');
  const row={fixtureId:'fixture-'+hash.slice(0,40),case:f.id,expectedText:f.text,synthetic:true,sha256:hash,startedAt:Date.now(),playbackRequested:mode==='auto'};report.results.push(row);save();
  const accepted=await api('practice/audio',{fixtureId:row.fixtureId,b64:bytes.toString('base64'),language:f.language});
  row.accepted=!!accepted.accepted;row.transcript=accepted.text||'';row.transcriptionMs=accepted.transcriptionMs;row.engine=accepted.engine;row.eventId=accepted.id;row.error=accepted.reason;
  row.transcriptionMatched=(f.expectedFragments||[]).some(x=>compact(row.transcript).includes(compact(x)));
  if(!row.accepted){save();continue;}
  let latest=null,playStarted=false;const deadline=Date.now()+45000;
  while(Date.now()<deadline){const s=await api('status');if(s.live?.active)throw new Error('public_mode_changed_during_rehearsal');if(s.lastDecision?.event?.id===row.eventId)latest=s.lastDecision;if(s.active?.event?.id===row.eventId&&s.active.started){playStarted=true;row.timeToPlaybackMs??=Date.now()-row.startedAt;}if(latest&&!s.busy&&!s.active)break;await sleep(500);}
  row.decision=latest?{action:latest.action,text:latest.text,clipId:latest.clipId,reason:latest.reason,decisionMs:latest.decisionMs}:null;
  const history=await api('history');row.playbackStarted=playStarted||history.some(h=>h.direction==='out'&&h.eventId===row.eventId);
  const end=await api('status');row.playbackSettled=row.playbackStarted&&!end.active&&end.mode!=='manual';
  row.outputLanguageMatched=!latest||latest.action==='ignore'||(f.language==='en'?/[a-z]/i.test(latest.text):/[\u0590-\u05ff]/.test(latest.text));
  row.passed=row.transcriptionMatched&&!!latest&&row.outputLanguageMatched&&f.expectedActions.includes(latest.action)&&(latest.action!=='play'||mode==='rehearsal'||row.playbackSettled);
  row.missingVideo=latest?.action==='draft';row.finishedAt=Date.now();save();console.log(JSON.stringify({case:f.id,transcriptionMatched:row.transcriptionMatched,action:latest?.action,passed:row.passed,playbackStarted:row.playbackStarted,missingVideo:row.missingVideo}));await sleep(1500);
 }
}catch(e){report.error=/^[a-z0-9_]+$/.test(e.message||'')?e.message:'audio_rehearsal_failed';}
finally{
 const s=await api('status').catch(()=>null);if(s&&!s.live?.active)await api('mode',{mode:initial.mode}).catch(()=>{});
 const eventIds=new Set(report.results.map(r=>r.eventId));report.productionExcluded=[];
 try{for(const row of await api('inbox'))if(row.state==='pending'&&eventIds.has(row.event?.id)){await api('resolve',{id:row.id,action:'production_exclude'});report.productionExcluded.push(row.id);}}catch{report.cleanupError='test_gaps_require_production_exclusion';}
 report.finishedAt=Date.now();report.passed=report.results.filter(r=>r.passed).length;save();console.log(JSON.stringify({report:file,completed:report.results.length,passed:report.passed,error:report.error||'',actualMicrophoneTested:false}));
}
