import fs from 'node:fs';
import {operatorMessage} from './live-operator.mjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { Budget } from './performer-core.mjs';
import { VideoDirector } from './video-director.mjs';
import { VideoDecisionProvider } from './video-director-provider.mjs';
import { LocalTranscriber } from './local-transcriber.mjs';
import { practiceCases, defaultPersona } from './chino-practice.mjs';
import { VideoProduction } from './video-production.mjs';
import { SingleAttemptVideoProvider } from './video-production-provider.mjs';
import { fold } from './video-answer-index.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {explanations} from './chino-explanations.mjs';
import {performances,performanceFor,composePerformance} from './chino-performances.mjs';
import {autonomyCases} from './video-autonomy-cases.mjs';

export function liveReadiness({provider,stage,live,context,now=Date.now()}){
  const chat=context.audienceConnection||{},budget=provider.budget;
  const checks={gpt:{ready:!!provider.configured&&!provider.blocked&&(!budget||budget.reservedUSD+.1<=budget.limitUSD),verifiedAt:provider.lastVerifiedAt||0},output:{ready:!!stage.ready},audio:{ready:!!live.audioConnected,signalSeen:!!live.signalAt&&now-live.signalAt<10000,transcribedAt:live.lastTranscriptAt||0,level:live.level||0},chat:{ready:!!chat.connected&&!!chat.on&&/^מחובר ✓/.test(chat.status||''),lastEventAt:chat.lastEventAt||0,eventCount:chat.eventCount||0}};
  return {ready:Object.values(checks).every(c=>c.ready),checks};
}

export function filterLearningRecommendations(recommendations,gaps,clips){
  const questions=new Set(gaps.map(g=>fold(g.question))),recorded=new Set(clips.map(c=>fold(c.text))),seen=new Set();
  return (Array.isArray(recommendations)?recommendations:[]).filter(r=>{
    const answer=fold(r?.suggestedAnswer),question=fold(r?.question);
    if(!questions.has(question)||!answer||recorded.has(answer)||seen.has(answer))return false;
    seen.add(answer);return true;
  }).slice(0,6);
}

export function createVideoDirector({ root, bank, emit, context, onMode, onSpoken, productionEnabled=false, port = 7777 }) {
  const dataDir = path.join(root, 'data', 'video-director'); fs.mkdirSync(dataDir, { recursive: true });
  // Cumulative OpenAI budget within the user's explicit $100 authorization.
  // Preserve the cumulative ledger; reservations are not a provider invoice.
  const budget = new Budget(path.join(dataDir, 'budget.json'), 100);
  const provider = new VideoDecisionProvider({ budget, audioDir: dataDir, originalVoice: { status: () => ({}) } });
  const load = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir,f),'utf8')); } catch { return d; } };
  const explanationText=explanations[0].text;
  let production=null;
  const live={inputMode:productionEnabled?'live':'practice',active:false,audioConnected:false,audioSeen:0,audioSource:'',level:0,signalAt:0,lastTranscriptAt:0,error:''};
  const liveStatus=()=>({...live,audioConnected:live.audioConnected&&Date.now()-live.audioSeen<6000,explanationText,explanationReady:catalog().some(c=>c.ready&&fold(c.text)===fold(explanationText)),explanations:explanations.map(x=>({...x,ready:catalog().some(c=>c.ready&&fold(c.text)===fold(x.text))}))});
  let persona = load('persona.json',defaultPersona), practiceState = { running: false, completed: 0, error: '' };
  const catalog = () => [...bank().map(b=>({...b,folder:'bank'})),...load('generated-bank.json',[]).map(b=>({...b,folder:'generated'}))].map(b => ({ id:b.id,text:b.text,file:'/media/'+b.folder+'/'+b.file, ...(b.performanceId?{performanceId:b.performanceId,performanceDescription:b.performanceDescription}:{}), motionTemplate:b.motionTemplate===true||performances.some(p=>p.id===b.performanceId&&p.interactionMotion===true), ready:path.basename(b.file)===b.file&&fs.existsSync(path.join(root,'media',b.folder,b.file)) }));
  const director = new VideoDirector({ file: path.join(dataDir, 'state.json'), catalog,
    decide: (packet, signal) => provider.decideVideo(packet, signal), providerStatus: () => ({ ...provider.status(), budget: budget.status() }),
    context: () => ({...context(),character:persona}), output: (type, data) => emit('director-' + type, data),
    emit: (type, data) => { emit(type, data); if (type === 'director-spoken') onSpoken(data); if(type==='director-inbox'&&live.active&&data.decision?.action==='draft')production?.offerLive(data.item,data.event,data.decision); },
  });
  practiceState.completed=director.saved.inbox.filter(x=>x.practice).length;
  if(!catalog().some(c=>c.ready&&fold(c.text)==='דבר')&&!director.saved.inbox.some(r=>r.state==='pending'&&fold(r.draft)==='דבר')){
    director.missing({id:'wake-phrase',type:'opponent',text:'צינו',wakeOnly:true,uid:'',name:'',room:'',language:'he',source:'setup',t:Date.now()},{text:'דבר',reason:'wake_phrase_missing'});
  }
  const videoProvider=new SingleAttemptVideoProvider({root});
  const runFile=promisify(execFile);
  const inspectGenerated=async c=>{
    if(!c||path.basename(c.file)!==c.file)throw new Error('generated_file_missing');
    const file=path.join(root,'media','generated',c.file);
    const probe=JSON.parse((await runFile('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',file],{windowsHide:true,timeout:15000})).stdout);
    const duration=Number(probe.format?.duration),video=probe.streams?.find(x=>x.codec_type==='video');
    if(!video||!probe.streams.some(x=>x.codec_type==='audio')||!Number.isFinite(duration)||duration<=0||duration>15.5)throw new Error('generated_media_invalid');
    return {file,duration,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
  };
  const registerGenerated=(job,validation,manualReview,c=job.generated)=>{
    const entries=load('generated-bank.json',[]);
    if(!entries.some(x=>x.id===c.id))entries.push({...c,transcript:job.transcript,duration:validation.duration,sha256:validation.sha256,review:job.review,...(manualReview?{manualReview}:{})});
    const store=path.join(dataDir,'generated-bank.json');fs.writeFileSync(store+'.tmp',JSON.stringify(entries,null,2));fs.renameSync(store+'.tmp',store);
    return director.library().find(x=>x.id===c.id&&x.ready);
  };
  production=productionEnabled?new VideoProduction({file:path.join(dataDir,'production.json'),director,
    analysisReserved:()=>budget.status().reservedUSD,
    preflight:async()=>{
      if(!provider.status().configured||provider.status().blocked)throw new Error('openai_key_required');
      videoProvider.preflight();
      await Promise.all(['ffmpeg','ffprobe'].map(tool=>runFile(tool,['-version'],{windowsHide:true,timeout:10000})));
    },
    submit:async job=>{job.state='generating';production.save();job.generated=await videoProvider.generate(job);production.save();},
    prepareEdit:async(job,decision)=>{
      const original=await inspectGenerated(job.generated);
      if(original.sha256!==decision.sha256||original.sha256!==job.validation?.sha256)throw new Error('generated_file_changed');
      const id=job.generated.id+'-edited';
      if(decision.editedFile!==id+'.mp4')throw new Error('invalid_edited_file');
      const candidate={...job.generated,id,file:decision.editedFile,sourceFile:job.generated.file,sourceSha256:original.sha256,localEdit:decision.note};
      const edited=await inspectGenerated(candidate);
      if(edited.sha256!==decision.editedSha256||edited.duration>original.duration+.05)throw new Error('edited_file_changed');
      return candidate;
    },
    acceptReview:async(job,decision)=>{
      const validation=await inspectGenerated(job.generated);
      if(validation.sha256!==decision.sha256||(job.validation&&validation.sha256!==job.validation.sha256))throw new Error('generated_file_changed');
      if(job.performanceId){
        const composite=await composePerformance({root,job,decision});
        const finalValidation=await inspectGenerated(composite);
        job.performanceComposite={id:composite.id,file:composite.file,sha256:finalValidation.sha256};
        return registerGenerated(job,finalValidation,decision,composite);
      }
      return registerGenerated(job,validation,decision);
    },
    verify:async job=>{
      const validation=await inspectGenerated(job.generated),{file,duration}=validation;job.validation=validation;
      job.state='verifying';production.save();
      const temp=[];
      try{
        const audioFile=path.join(dataDir,'verify-'+job.id+'.webm');temp.push(audioFile);
        await runFile('ffmpeg',['-v','error','-y','-i',file,'-vn','-ac','1','-ar','16000','-c:a','libopus',audioFile],{windowsHide:true,timeout:30000});
        const transcript=await provider.transcribeAudio(fs.readFileSync(audioFile).toString('base64'));job.transcript=transcript;production.save();
        if(fold(transcript)!==fold(job.text))throw new Error('generated_words_review_required');
        const frames=[];
        for(const [i,t] of [duration*.08,duration*.5,duration*.9].entries()){
          const frame=path.join(dataDir,'verify-'+job.id+'-'+i+'.png');temp.push(frame);
          await runFile('ffmpeg',['-v','error','-y','-ss',String(t),'-i',file,'-frames:v','1','-vf','scale=512:-2',frame],{windowsHide:true,timeout:30000});frames.push(fs.readFileSync(frame).toString('base64'));
        }
        const review=await provider.reviewVideoFrames([fs.readFileSync(path.join(root,'media','master.png')).toString('base64'),...frames]);job.review=review;production.save();
        if(!review.identityStable||review.score<7||review.defects.length)throw new Error('generated_quality_review_required');
        // Sampled identity frames cannot prove a hand gesture or its release
        // time. Keep this out of the playable library until motion is reviewed.
        if(job.performanceId)throw new Error('generated_performance_review_required');
        return registerGenerated(job,validation);
      }finally{for(const f of temp)if(fs.existsSync(f))fs.unlinkSync(f);}
    },
  }):null;
  const reserveAI=budget.reserve.bind(budget);budget.reserve=(kind,usd)=>{const b=production?.sessionBudget();if(b&&b.totalReservedUSD+usd>b.limitUSD+.00001)throw new Error('live_budget_exhausted');return reserveAI(kind,usd);};
  let operatorBusy=false;
  const performanceStatus=()=>performances.map(p=>{
    const clip=catalog().find(c=>c.ready&&c.performanceId===p.id);
    const job=production?.data.jobs.findLast(j=>j.performanceId===p.id);
    return {id:p.id,title:p.title,text:p.text,description:p.description,seconds:p.seconds,
      ready:!!clip,clipId:clip?.id||null,state:clip?'ready':job?.state||'needs_recording',error:job?.error||'',
      estimatedVideoUSD:Number((p.seconds*.07).toFixed(2)),reservationUSD:1.15};
  });
  let asr = null;
  try { const cfg = JSON.parse(fs.readFileSync(path.join(root, 'data', 'local-transcription-config.json'), 'utf8'));
    if (cfg.model) asr = new LocalTranscriber(path.join(root, '.venv-learning', 'Scripts', 'python.exe'), [path.join(root, 'tools', 'transcribe_local.py'), cfg.model]);
  } catch {}
  const timer = setInterval(() => { director.tick().catch(() => {}); if(live.active)director.prepareChat().catch(()=>{}); production?.tickLive().catch(()=>{}); if(live.audioConnected&&Date.now()-live.audioSeen>=6000){live.audioConnected=false;director.hold('otherSpeaking',false);} }, 200); timer.unref();
  const json = (res, value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  async function read(req, max = 32000) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error('body_too_large'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  }
  async function audio(b) {
    const microphone=b.source==='microphone';
    if(microphone&&live.inputMode==='live')return {accepted:false,reason:'microphone_disabled_in_live'};
    if(!microphone&&productionEnabled&&(!live.active||!liveStatus().audioConnected))return {accepted:false,reason:'live_audio_not_connected'};
    if (!microphone&&b.isolatedOpponent !== true) return { accepted: false, reason: 'isolated_opponent_audio_required' };
    if (!asr&&!provider.status().configured) throw new Error('local_transcription_unavailable');
    if ((microphone&&director.active) || director.externalClip || director.muted) return { accepted: false, reason: 'input_held_during_output' };
    if (typeof b.b64 !== 'string' || b.b64.length > 2800000 || !/^[\w+/=]+$/.test(b.b64)) throw new Error('invalid_audio');
    const epoch = director.audioEpoch, t = Date.now(), room = director.room;
    const engine=provider.status().configured?'openai':'local';
    let text;
    if(engine==='openai')text=await provider.transcribeAudio(b.b64);
    else {const r=await asr.transcribe(b.b64,{language:['he','en'].includes(b.language)?b.language:undefined,initialPrompt:'צ׳ינו, צינו, Chino. שיחה עם צ׳ינו, דמות אריה וירטואלית.'});
      text=(r.lines||[]).filter(l=>l.avgLogprob>-1&&(l.noSpeechProb==null||l.noSpeechProb<0.6)).map(l=>l.text).join(' ').trim();}
    if (epoch !== director.audioEpoch || room !== director.room || (microphone&&director.active) || director.muted || director.externalClip || Date.now() - t >= 20000) return { accepted: false, reason: 'stale_audio' };
    if (!text) return { accepted: false, reason: 'no_clear_speech' };
    if(!microphone&&director.isOwnEcho(text))return {accepted:false,reason:'own_audio_echo',engine};
    live.lastTranscriptAt=Date.now();
    const opponent = context().opponent || {};
    const result = director.receive({ type: 'opponent', text, uid: opponent.handle || '', name: opponent.name || '', source: microphone?'microphone':'isolated_audio', t });
    emit('heard', { text }); return { ...result, text, engine, transcriptionMs: Date.now() - t };
  }
  let reportPromise=null;
  let evaluation={...load('autonomy-evaluation-latest.json',{completed:0,total:100,results:[],error:''}),running:false},evaluationController=null;
  async function runEvaluation(){
    if(live.active||director.active||director.busy||evaluation.running)throw new Error('evaluation_requires_idle');
    if(!provider.status().configured)throw new Error('openai_key_required');
    if(budget.status().reservedUSD+1>budget.status().limitUSD)throw new Error('budget_limit');
    evaluation={running:true,startedAt:Date.now(),completed:0,total:100,results:[],error:'',kind:'single_pass_semantic_cases_no_playback'};evaluationController=new AbortController();
    (async()=>{try{
      for(let offset=0;offset<autonomyCases.length;offset+=5){
        evaluationController.signal.throwIfAborted();
        const cases=autonomyCases.slice(offset,offset+5),packets=cases.map(c=>{const event={id:c.id,text:c.text,rawText:c.text,type:c.role,uid:'evaluation-'+c.id,room:director.room,language:'he',source:'evaluation',addressedBy:'explicit_test',t:Date.now()};return {id:c.id,event,context:{character:persona,opponent:{},battle:null},history:[],participantMemory:null,candidates:director.answerIndex.rank(event,director.eligible(event,{semanticReview:true})),reviewStage:'select_existing'};});
        const response=await provider.decideVideo({evaluationCases:packets},evaluationController.signal);
        if(!Array.isArray(response.decisions)||response.decisions.length!==cases.length)throw new Error('decision_invalid_evaluation');
        for(const c of cases){const d=response.decisions.find(r=>r.id===c.id)?.decision;if(!d)throw new Error('decision_invalid_evaluation');const expected=c.expected;
          const correct=expected.oneOfActions?expected.oneOfActions.includes(d.action):d.action===expected.action&&(expected.clipId?d.clipId===expected.clipId:expected.oneOf.includes(d.clipId));
          const valid=d.action!=='play'||packets.find(p=>p.id===c.id).candidates.some(x=>x.id===d.clipId&&x.text===d.text)&&d.confidence>=.88;
          evaluation.results.push({id:c.id,text:c.text,role:c.role,expected,action:d.action,clipId:d.clipId,textAnswer:d.text,reason:d.reason,passed:correct&&valid});evaluation.completed++;
        }
        if(offset+5<autonomyCases.length)await new Promise(r=>setTimeout(r,3200));
      }
    }catch(e){evaluation.error=e.name==='AbortError'?'evaluation_cancelled':/^[a-z0-9_]+$/.test(e.message)?e.message:'evaluation_failed';}
    finally{evaluation.running=false;evaluation.finishedAt=Date.now();evaluation.passed=evaluation.results.filter(r=>r.passed).length;fs.writeFileSync(path.join(dataDir,'autonomy-evaluation-'+evaluation.startedAt+'.json'),JSON.stringify(evaluation,null,2));fs.writeFileSync(path.join(dataDir,'autonomy-evaluation-latest.json'),JSON.stringify(evaluation,null,2));evaluationController=null;}})();
    return {started:true,total:100,maxRequests:20,reservationUSD:1,noPlayback:true,noVideoGeneration:true};
  }
  async function finishReport(){
    if(live.active)throw new Error('report_wait_until_live_ends');
    if(reportPromise)return reportPromise;
    const session=director.saved.sessions.at(-1),report=director.learningReport(session?.startedAt||0);
    if(!report.events&&!report.gaps.length)return {skipped:true,reason:'no_session_data'};
    if(session?.reportState==='complete')return session.review;
    reportPromise=(async()=>{
      if(session){session.endedAt??=Date.now();session.reportState='analyzing';director.save();}
      try{
        const audienceSources=new Set(['tiktools','isolated_audio','director_cadence']);
        const reviewableIds=new Set(director.saved.inbox.filter(r=>audienceSources.has(r.event.source)).map(r=>r.id));
        const gaps=report.gaps.filter(g=>g.rowIds.some(id=>reviewableIds.has(id))),availableClips=catalog().filter(c=>c.ready).map(c=>({text:c.text,id:c.id}));
        const review=await provider.reviewSession({analysisScope:session?'live_session':'library_and_practice_only_no_verified_live',statistics:{...report,gaps,latestSession:undefined},availableClips});
        if(typeof review.summary!=='string'||!Array.isArray(review.recommendations))throw new Error('decision_invalid_report');
        review.recommendations=filterLearningRecommendations(review.recommendations,gaps,availableClips);
        const saved={at:Date.now(),...review,proposalsOnly:true};
        if(session){session.review=saved;session.reportState='complete';}director.saved.latestReview=saved;director.save();return saved;
      }catch(e){if(session){session.reportState='failed';session.reportError=/^[a-z0-9_]+$/.test(e.message)?e.message:'decision_failed';director.save();}throw e;}
      finally{reportPromise=null;}
    })();return reportPromise;
  }
  async function handle(req, res, route) {
    if (!route.startsWith('/api/director/')) return false;
    const allowed = new Set(['http://localhost:' + port, 'http://127.0.0.1:' + port]);
    if (!['localhost:' + port, '127.0.0.1:' + port].includes(req.headers.host || '') || (req.headers.origin && !allowed.has(req.headers.origin))) { json(res, { error: 'origin_not_allowed' }, 403); return true; }
    try {
      if (req.method === 'GET') {
        if (route === '/api/director/status') {const s=director.status(),l=liveStatus();json(res, { ...s, live:l,readiness:liveReadiness({provider:s.provider,stage:s.stage,live:l,context:context()}), index:director.answerIndex.status(), production:production?.status(), transcription: {...asr?.status(),selectedEngine:provider.status().configured?'openai':'local'}, context: context(), persona, practice: practiceState,operatorHelp:director.saved.inbox.filter(r=>r.state==='pending'&&!r.practice&&!r.productionExcluded&&['tiktools','isolated_audio','director_cadence'].includes(r.event.source)&&!production?.data.autoQueue.some(q=>['queued','starting'].includes(q.state)&&q.rows.includes(r.id))).slice(-5).map(r=>({id:r.id,question:r.event.text,draft:r.draft})) });}
        else if(route==='/api/director/operator')json(res,{messages:(director.saved.operatorMessages||[]).slice(-40)});
        else if(route==='/api/director/memory')json(res,Object.entries(director.saved.people).filter(([,p])=>!p.room||p.room===director.room).sort((a,b)=>b[1].lastSeen-a[1].lastSeen).slice(0,100).map(([key,p])=>({key,...p})));
        else if(route==='/api/director/report')json(res,{...director.learningReport(),review:director.saved.latestReview||null,analyzing:!!reportPromise});
        else if(route==='/api/director/evaluation')json(res,evaluation);
        else if (route === '/api/director/attention') json(res,{conversation:director.dialogueStatus(),queue:director.queue.filter(e=>e.type==='chat'||e.type==='gift').length});
        else if (route === '/api/director/library') json(res, director.library());
        else if (route === '/api/director/index') json(res,{...director.answerIndex.status(),matches:director.answerIndex.data.matches});
        else if (route === '/api/director/production') json(res,production?.status()||{available:false});
        else if (route === '/api/director/performances') json(res,performanceStatus());
        else if (route === '/api/director/inbox') json(res, director.saved.inbox.slice(-100).reverse());
        else if (route === '/api/director/history') json(res, director.saved.history.slice(-50));
        else if (route === '/api/director/export') json(res, { version: 1, drafts: director.saved.inbox.filter(x => x.state === 'pending'&&x.draft&&(!x.practice||x.practice.action==='answer')).map(x => ({ id: x.id, trigger: x.event.text, language: x.event.language, text: x.draft, videoReady: false })), lessons: director.saved.lessons, note: 'No video generation is triggered. Approved corrections are retrieval examples, not model training.' });
        else json(res, { error: 'not_found' }, 404);
        return true;
      }
      if (req.method !== 'POST') { json(res, { error: 'method_not_allowed' }, 405); return true; }
      const b = await read(req, route === '/api/director/audio' ? 3000000 : 32000);
      let result;
      switch (route) {
        case '/api/director/voice/auditions/check': {
          if(live.active||director.busy||evaluation.running)throw new Error('evaluation_requires_idle');
          const configuration=JSON.parse(fs.readFileSync(path.join(root,'data','local-voice-config.json'),'utf8')),rows=[];
          for(const language of ['he','en']){
            const file=path.join(root,'media','speech','lion-clone-audition-'+language+'.wav');
            const transcript=await provider.transcribeAudio(fs.readFileSync(file).toString('base64'));
            rows.push({language,expected:configuration.auditions.find(a=>a.language===language)?.text||'',transcript,automaticCheckOnly:true});
          }
          result={at:Date.now(),provider:'openai',approved:false,rows};
          fs.writeFileSync(path.join(dataDir,'voice-audition-openai-check.json'),JSON.stringify(result,null,2));break;
        }
        case '/api/director/observations/analyze': {
          if(!Array.isArray(b.batch)||!b.batch.length||b.batch.length>100)throw new Error('invalid_observation_batch');
          const batch=b.batch.map(x=>({who:['HOST','OTHER'].includes(x.who)?x.who:'UNKNOWN',text:String(x.text||'').slice(0,500),t:Number(x.t)||0}));
          const events=(Array.isArray(b.events)?b.events:[]).slice(-60).map(x=>({kind:String(x.k||'').slice(0,40),text:String(x.text||'').slice(0,300),t:Number(x.t)||0}));
          const review=await provider.reviewSession({kind:'observations_from_another_live_unverified',observations:batch,events,instructionContext:'Speakers and outcomes may be unknown. Sequence is not causality. Propose original CHINO responses, never copy the observed streamer.'});
          result={lines:review.recommendations.map(r=>({text:r.suggestedAnswer,when:r.question,kind:'other'})),styles:[review.summary],battle:[],chat:[],situations:[],analysisProvider:'openai',status:'unvalidated'};break;
        }
        case '/api/director/evaluation/start': result=await runEvaluation();break;
        case '/api/director/evaluation/stop': evaluationController?.abort();result={stopping:!!evaluation.running};break;
        case '/api/director/operator': {if(operatorBusy)throw new Error('operator_busy');operatorBusy=true;try{result=await operatorMessage({director,provider,production,live,persona,savePersona:next=>{persona=next;fs.writeFileSync(path.join(dataDir,'persona.json'),JSON.stringify(persona,null,2));}},b);}finally{operatorBusy=false;}break;}
        case '/api/director/memory': result=director.updateMemory(b);break;
        case '/api/director/report': result=await finishReport();break;
        case '/api/director/report/adopt': {
          const suggestion=director.saved.latestReview?.recommendations[b.index];if(!Number.isInteger(b.index)||!suggestion)throw new Error('invalid_report_suggestion');
          const prior=director.saved.inbox.find(x=>x.state==='pending'&&x.event.source==='post_live_review'&&x.draft===suggestion.suggestedAnswer);
          if(prior){result={saved:true,id:prior.id,generated:false};break;}
          const row=director.missing({id:crypto.randomUUID(),type:'audience',text:String(suggestion.question).slice(0,500),source:'post_live_review',room:director.room,uid:'',language:'he',t:Date.now()},{text:String(suggestion.suggestedAnswer).slice(0,350),reason:'post_live_suggestion'});row.productionExcluded=true;director.save();result={saved:true,id:row.id,generated:false};break;
        }
        case '/api/director/performance': {
          if(!production)throw new Error('production_unavailable');
          const p=performanceFor(b.id);if(!p)throw new Error('invalid_performance');
          const clip=director.library().find(c=>c.ready&&c.performanceId===p.id);
          if(clip){
            if(!b.prepareOnly){director.cancel('operator_performance');director.play(clip,{id:crypto.randomUUID(),type:'audience',text:p.title,uid:'',room:director.room,t:Date.now(),source:'operator',language:'he'});}
            result={ready:true,clipId:clip.id};break;
          }
          const previous=production.data.jobs.findLast(j=>j.performanceId===p.id);
          if(previous){result={ready:false,state:previous.state,error:previous.error||'',alreadySubmitted:true};break;}
          let row=director.saved.inbox.find(r=>r.state==='pending'&&r.performanceId===p.id);
          if(!row){
            const event={id:crypto.randomUUID(),type:'audience',text:p.description,uid:'',room:director.room,language:'he',source:p.interactionMotion?'setup':'operator',t:Date.now()};
            row=director.missing(event,{text:p.text,reason:'performance_recording_missing'});
            Object.assign(row,{performanceId:p.id,performanceDescription:p.description,operatorApprovedText:true,productionExcluded:true});director.save();
          }
          if(b.withinLiveBudget===true&&p.interactionMotion){result={ready:false,itemId:row.id,...production.offerLive(row,row.event,{text:p.text,confidence:1},{explicit:true})};break;}
          result={ready:false,item:row,quote:production.quote({id:row.id,text:p.text})};break;
        }
        case '/api/director/mode': director.setMode(b.mode); if(b.mode!=='auto'){production?.stop();live.active=false;live.audioConnected=false;} onMode(b.mode); result = director.status(); break;
        case '/api/director/event': result = director.receive({ ...b, source: 'operator_test' }); break;
        case '/api/director/activity': if(live.inputMode==='live'&&b.source!=='isolated_audio'){result={ok:false,reason:'microphone_disabled_in_live'};break;} if(!director.active||b.source==='microphone')director.hold('otherSpeaking', b.active === true); result = { ok: true }; break;
        case '/api/director/live/authorize': if(!production)throw new Error('production_unavailable');result=production.authorizeLive(b);break;
        case '/api/director/live/start': {
          if(evaluation.running)throw new Error('evaluation_in_progress');
          if(!production)throw new Error('production_unavailable');
          if(!provider.status().configured||provider.status().blocked)throw new Error('openai_unavailable_operator_required');
          if(!director.stageReady())throw new Error('stage_not_available');
          if(!['window','browser'].includes(b.surface)||b.audio!==true)throw new Error('isolated_opponent_audio_required');
          const room=String(b.room||director.room);if(!/^[\w.]{2,50}$/.test(room))throw new Error('invalid_tiktok_handle');
          if(!production.data.autoSession||production.data.autoSession.room!==room)throw new Error('live_budget_approval_required');
          if(!production.data.autoSession.error)production.enableLive(room);director.setRoom(room);director.cancel('live_started',true,true);director.endDialogue();director.hold('otherSpeaking',false);
          Object.assign(live,{inputMode:'live',active:true,audioConnected:true,audioSeen:Date.now(),audioSource:String(b.label||'LIVE Studio').slice(0,120),error:''});
          director.setMode('auto');director.startSession();onMode('auto');result=liveStatus();break;
        }
        case '/api/director/live/audio': {
          if(!live.active)throw new Error('live_not_active');
          live.audioConnected=b.connected===true;live.audioSeen=Date.now();live.level=Math.max(0,Math.min(1,Number(b.level)||0));if(live.level>.008)live.signalAt=Date.now();if(!live.audioConnected)director.hold('otherSpeaking',false);result=liveStatus();break;
        }
        case '/api/director/live/stop': production?.stop();Object.assign(live,{active:false,audioConnected:false});director.hold('otherSpeaking',false);director.setMode('manual');onMode('manual');director.endDialogue();finishReport().catch(()=>{});result=liveStatus();break;
        case '/api/director/input/practice': production?.stop();Object.assign(live,{inputMode:'practice',active:false,audioConnected:false});director.hold('otherSpeaking',false);result=liveStatus();break;
        case '/api/director/explanation': {
          if(!production)throw new Error('production_unavailable');
          const explanation=explanations.find(x=>x.id===(b.kind||'voice'));if(!explanation)throw new Error('invalid_explanation');
          const ready=catalog().some(c=>c.ready&&fold(c.text)===fold(explanation.text));
          if(ready){result=b.prepareOnly?{ready:true}:director.operatorSay(explanation.text);break;}
          const event={id:'live-explanation-'+explanation.id,type:'audience',text:explanation.title,source:'setup',room:director.room,uid:'',language:'he',t:Date.now()};
          const decision={text:explanation.text,confidence:1,reason:'explanation_recording_missing'};
          const row=director.missing(event,decision);row.operatorApprovedText=true;director.save();
          result={ready:false,...production.offerLive(row,event,decision,{explicit:true,approvedRetry:b.approvedRetry===true})};break;
        }
        case '/api/director/live/lines': {
          if(!live.active)throw new Error('live_not_active');
          if(!production)throw new Error('production_unavailable');
          result={results:production.offerOperatorLines(b.lines)};break;
        }
        case '/api/director/conversation/end': director.cancel('conversation_ended',true,true); director.endDialogue(); result={ok:true}; break;
        case '/api/director/room': director.setRoom(b.room); result = director.status(); break;
        case '/api/director/stage': result = director.heartbeat(b); break;
        case '/api/director/playback': result = director.playback(b); break;
        case '/api/director/credential': provider.setKey(b.key); result = { configured: true, persistence: 'memory_only' }; break;
        case '/api/director/resolve': result = director.resolve(b); break;
        case '/api/director/understanding': result = director.correctUnderstanding(b); break;
        case '/api/director/production/start': throw new Error('production_individual_approval_required');
        case '/api/director/production/quote': if(!production)throw new Error('production_unavailable');result=production.quote(b);break;
        case '/api/director/production/approve': if(!production)throw new Error('production_unavailable');result=await production.approveQuote(b);break;
        case '/api/director/production/review': if(!production)throw new Error('production_unavailable');result=await production.approveQualityReview(b);break;
        case '/api/director/production/recheck-edited': if(!production)throw new Error('production_unavailable');result=await production.recheckEdited(b);break;
        case '/api/director/production/stop': if(!production)throw new Error('production_unavailable');result=production.stop();break;
        case '/api/director/clip': director.updateClip(b.id, b.auto, b.roles); result = { ok: true }; break;
        case '/api/director/audio': result = await audio(b); break;
        case '/api/director/audio/warmup': {
          if(!asr)throw new Error('local_transcription_unavailable');
          const wav=Buffer.alloc(32044);wav.write('RIFF',0);wav.writeUInt32LE(32036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
          await asr.transcribe(wav.toString('base64'));result={ready:true};break;
        }
        case '/api/director/persona': {
          if (typeof b.style !== 'string' || !b.style.trim() || b.style.length > 1800) throw new Error('invalid_style');
          persona = {name:'צ׳ינו',style:b.style.trim()}; fs.writeFileSync(path.join(dataDir,'persona.json'),JSON.stringify(persona,null,2));result=persona;break;
        }
        case '/api/director/practice': {
          if (practiceState.running) throw new Error('practice_already_running');
          if (!provider.status().configured) throw new Error('openai_key_required');
          director.setMode('rehearsal'); onMode('rehearsal'); practiceState={running:true,completed:0,error:''};
          result={started:true,cases:practiceCases.length};
          (async()=>{try{
            let observations=[];try{observations=JSON.parse(fs.readFileSync(path.join(root,'data','chat-reviewed-behaviors.json'),'utf8')).cases.map(c=>({policy:c.policy,confidence:c.confidence}));}catch{}
            const corrections=director.saved.inbox.filter(x=>x.operatorApprovedText).slice(-30).map(x=>({question:x.event.text,answer:x.draft,scope:x.event.type}));
            const r=await provider.practice({persona,cases:practiceCases,observations,operatorApprovedCorrections:corrections});
            if(!Array.isArray(r.answers)||r.answers.length!==practiceCases.length||new Set(r.answers.map(x=>x.id)).size!==practiceCases.length)throw new Error('practice_invalid_response');
            for(const a of r.answers){if(!practiceCases.some(c=>c.id===a.id)||typeof a.text!=='string'||a.text.length>350||!['answer','listen','ignore'].includes(a.action))throw new Error('practice_invalid_response');}
            const runId=Date.now();
            for(const c of practiceCases){const a=r.answers.find(x=>x.id===c.id);const row=director.missing({...c,t:Date.now(),id:'practice-'+runId+'-'+c.id},{text:a.text,reason:a.reason});row.practice={runId,caseId:c.id,action:a.action};practiceState.completed++;}
            director.save();fs.writeFileSync(path.join(dataDir,'practice-latest.json'),JSON.stringify({runId,persona,cases:practiceCases,answers:r.answers},null,2));
          }catch(e){practiceState.error=/^[a-z0-9_]+$/.test(e.message)?e.message:'practice_failed';}finally{practiceState.running=false;director.publish();}})();
          break;
        }
        default: json(res, { error: 'not_found' }, 404); return true;
      }
      json(res, result);
    } catch (e) { json(res, { error: /^[a-z0-9_]+$/.test(e.message) ? e.message : 'director_request_failed' }, 400); }
    return true;
  }
  return { director, handle, audio, provider, close() { evaluationController?.abort();clearInterval(timer); asr?.stop(); } };
}
