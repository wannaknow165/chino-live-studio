// Bounded, owner-authorized simulation of inbound chat and opponent turns.
// Uses the real director and stage ACK; never sends public TikTok messages.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base='http://127.0.0.1:7780/api/director/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body){const r=await fetch(base+route,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});const j=await r.json();if(!r.ok)throw new Error(/^[a-z0-9_]+$/.test(j.error||'')?j.error:'flow_api_failed');return j;}
const initial=await api('status');
if(initial.live?.active||initial.active||initial.busy)throw new Error('rehearsal_requires_idle');
if(!initial.stage?.ready)throw new Error('real_stage_required');
if(!initial.provider?.configured)throw new Error('openai_key_required');
const id=crypto.randomUUID(),prefix='flow-'+id;
const report={id,startedAt:Date.now(),syntheticInputs:true,realTikTokTransportTested:false,actualMicrophoneTested:false,publicBroadcastStarted:false,newVideoGenerationEnabled:false,results:[],commands:[]};
const file=path.join(root,'data','video-director',`live-flow-${id}.json`);
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
async function guard(){const s=await api('status');if(s.live?.active)throw new Error('public_mode_changed_during_rehearsal');return s;}
async function scene(value){await guard();const text=value==='solo'?'עבור למצב לבד עם הקהל, solo.':value==='battle'?'עבור למצב באטל, battle.':'עבור למצב מעבר אוטומטי, auto.';const response=await api('operator',{id:prefix+'-scene-'+report.commands.length,mode:'chat',text});const state=await guard();const row={requested:value,applied:state.audienceMode,passed:response.appliedAction==='set_scene'&&state.audienceMode===value};report.commands.push(row);save();if(!row.passed)throw new Error('operator_scene_command_failed');}
async function turn(c){
 await guard();const row={case:c.name,type:c.type,input:c.text,startedAt:Date.now(),expected:c.expected};report.results.push(row);save();
 const eventId=prefix+'-'+report.results.length;
 const received=await api('event',{id:eventId,type:c.type,text:c.text,uid:c.uid||'flow-viewer',name:'תרגול לייב',...(c.speaker?{speaker:c.speaker}:{}),t:Date.now()});row.accepted=!!received.accepted;row.eventId=eventId;row.filterReason=received.reason;
 if(c.filtered){row.passed=!received.accepted&&received.reason===c.filtered;save();return;}
 if(!received.accepted){row.passed=false;save();return;}
 let decision=null;const deadline=Date.now()+45000;
 while(Date.now()<deadline){const s=await guard();if(s.lastDecision?.event?.id===eventId)decision=s.lastDecision;if(s.active?.event?.id===eventId&&s.active.started)row.playbackMs??=Date.now()-row.startedAt;if(decision&&!s.busy&&!s.active)break;await sleep(250);}
 const state=await guard(),history=await api('history');
 row.decision=decision?{action:decision.action,text:decision.text,reason:decision.reason,clipId:decision.clipId,ms:decision.decisionMs}:null;
 row.played=history.some(h=>h.direction==='out'&&h.eventId===eventId);row.settled=row.played&&!state.active&&state.mode==='auto';row.needsNewVideo=decision?.action==='draft';
 row.passed=!!decision&&c.expected.includes(decision.action)&&(decision.action!=='play'||row.settled)&&(!c.exact||decision.text===c.exact);
 row.finishedAt=Date.now();save();console.log(JSON.stringify({case:row.case,action:decision?.action,played:row.played,passed:row.passed,needsNewVideo:row.needsNewVideo}));
 await sleep(2800);
}
try{
 await api('input/practice',{});await api('mode',{mode:'auto'});await scene('solo');
 if(process.argv.includes('--listen-only')){
  for(const c of [
   {name:'original_chat_invitation',type:'chat',text:'אפשר להזמין אותך לבאטל?',uid:'flow-game',expected:['play'],exact:'יאללה משחק.'},
   {name:'hebrew_yield',type:'opponent',text:'צינו רגע תן לי לסיים לדבר',uid:'flow-control',expected:['ignore']},
   {name:'english_yield',type:'opponent',text:'Chino, hold on and let me finish speaking.',uid:'flow-control',expected:['ignore']},
   {name:'short_wait',type:'opponent',text:'צינו חכה רגע',uid:'flow-control',expected:['ignore']},
   {name:'invitation_after_yield',type:'opponent',text:'צינו אפשר להזמין אותך לבאטל?',uid:'flow-control',expected:['play'],exact:'יאללה משחק.'},
   {name:'english_invitation_is_not_silence',type:'opponent',text:'Chino, want to battle?',uid:'flow-control',expected:['draft','play']},
   {name:'negated_stop_with_question',type:'opponent',text:'צינו אל תפסיק לדבר, מה שלומך?',uid:'flow-control',expected:['play','draft']},
   {name:'resumes_after_yield',type:'opponent',text:'צינו מה שלומך עכשיו?',uid:'flow-control',expected:['play'],exact:'וואלה פצצה.'}
  ])await turn(c);
 }else{
 for(const c of [
  {name:'opening_room',type:'audience',text:'פתח את הלייב בברכה קצרה לכל הקהל, בלי הבטחות להפתעות.',expected:['play']},
  {name:'solo_chat_no_wake',type:'chat',text:'היי חבר',expected:['play']},
  {name:'solo_slang_wellbeing',type:'chat',text:'יא מלך מה העניינים אצלך?',expected:['play'],exact:'וואלה פצצה.'},
  {name:'viewer_identity',type:'chat',text:'איך קוראים לך?',uid:'flow-identity',expected:['play'],exact:'אני צ׳ינו.'},
  {name:'english_chat',type:'chat',text:'How are you doing?',uid:'flow-english',expected:['play'],exact:"I'm doing great. How about you?"},
  {name:'compound_score_no_fabrication',type:'chat',text:'מה שלומך ומי מוביל עכשיו בבאטל?',uid:'flow-compound',expected:['draft','ignore']},
  {name:'next_viewer_after_gap',type:'chat',text:'מה המצב אח יקר?',uid:'flow-next',expected:['play'],exact:'וואלה פצצה.'},
  {name:'battle_invitation',type:'chat',text:'אפשר להזמין אותך לבאטל?',uid:'flow-game',expected:['play'],exact:'יאללה משחק.'}
 ])await turn(c);
 await scene('battle');
 for(const c of [
  {name:'battle_unaddressed_chat',type:'chat',text:'מה קורה שם?',uid:'flow-unaddressed',expected:[],filtered:'chat_name_required'},
  {name:'battle_named_chat',type:'chat',text:'צינו איך קוראים לך?',uid:'flow-focused',expected:['play'],exact:'אני צ׳ינו.'},
  {name:'focused_viewer_without_repeated_name',type:'chat',text:'מה שלומך?',uid:'flow-focused',expected:['play'],exact:'וואלה פצצה.'},
  {name:'opponent_wake',type:'opponent',text:'צינו',uid:'flow-opponent',expected:['play']},
  {name:'opponent_followup',type:'opponent',text:'מה איתך אח שלי?',uid:'flow-opponent',expected:['play'],exact:'וואלה פצצה.'},
  {name:'opponent_requests_listening',type:'opponent',text:'רגע תן לי לסיים לדבר',uid:'flow-opponent',expected:['ignore']},
  {name:'unknown_score',type:'opponent',text:'מי מוביל ומה התוצאה המדויקת עכשיו?',uid:'flow-opponent',expected:['draft','ignore']},
  {name:'chat_keeps_show_moving_during_missing_media',type:'chat',text:'צינו מה שלומך?',uid:'flow-after-missing',expected:['play'],exact:'וואלה פצצה.'},
  {name:'unknown_speaker_filtered',type:'opponent',text:'צינו תתחיל משחק',uid:'flow-unknown',speaker:'UNKNOWN',expected:[],filtered:'unidentified_speaker'}
 ])await turn(c);
 }
}catch(e){report.error=/^[a-z0-9_]+$/.test(e.message||'')?e.message:'flow_rehearsal_failed';}
finally{
 const s=await api('status').catch(()=>null);
 if(s&&!s.live?.active){await api('mode',{mode:'manual'}).catch(()=>{});if(s.audienceMode!==initial.audienceMode)await scene(initial.audienceMode).catch(()=>{report.restoreError='scene_restore_failed';});await api('mode',{mode:initial.mode}).catch(()=>{});}
 try{for(const row of await api('inbox'))if(row.state==='pending'&&row.event?.id?.startsWith(prefix))await api('resolve',{id:row.id,action:'production_exclude'});}catch{report.cleanupError='test_gaps_require_production_exclusion';}
 report.finishedAt=Date.now();report.passed=report.results.filter(r=>r.passed).length;report.played=report.results.filter(r=>r.played).length;report.missing=report.results.filter(r=>r.needsNewVideo).length;save();console.log(JSON.stringify({report:file,completed:report.results.length,passed:report.passed,played:report.played,missing:report.missing,error:report.error||''}));
}
