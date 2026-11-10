import fs from 'node:fs';
import crypto from 'node:crypto';
import { fold, intentOf, reusableReply, standardReplies as standard, eventIntent, semanticGapKey } from './video-answer-index.mjs';
import {performanceFor,performanceMatches,validatePerformanceCue} from './chino-performances.mjs';

export class VideoProduction {
  constructor({file,director,submit,preflight,verify,acceptReview,prepareEdit,analysisReserved=()=>0,now=Date.now}){
    Object.assign(this,{file,director,submit,preflight,verify,acceptReview,prepareEdit,analysisReserved,now});this.running=false;this.stopped=false;this.stopEpoch=0;
    this.data={version:1,jobs:[],batch:null,quotes:[]};if(file&&fs.existsSync(file))this.data=JSON.parse(fs.readFileSync(file,'utf8'));this.data.quotes??=[];this.data.autoQueue??=[];
    if(this.data.autoSession)this.data.autoSession.enabled=false;
    // Never resubmit an uncertain paid operation after restart.
    for(const j of this.data.jobs)if(['submitting','generating','verifying'].includes(j.state))j.state='uncertain';
    for(const x of this.data.autoQueue)if(['queued','starting'].includes(x.state))x.state='cancelled';
    if(this.data.autoSession&&this.data.jobs.some(j=>j.sessionId===this.data.autoSession.id&&j.state==='uncertain'))this.data.autoSession.error='generation_submission_uncertain';
    this.save();
  }
  save(){if(this.file){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data,null,2));fs.renameSync(this.file+'.tmp',this.file);}}
  plan(){
    const groups=new Map(),library=this.director.library();
    for(const row of this.director.saved.inbox){
      if(row.state!=='pending'||!row.draft||row.productionExcluded||row.practice&&row.practice.action!=='answer')continue;
      const intent=eventIntent(row.event);let text=row.operatorApprovedText?row.draft:(row.event.language==='he'&&standard[intent]||row.draft);
      // Names in examples must not become a universal reusable recording.
      if(!row.operatorApprovedText&&row.event.name&&text.startsWith(row.event.name+','))text=text.slice(row.event.name.length+1).trim();
      const key=fold(text);if(!groups.has(key))groups.set(key,{key,text,intent,rows:[],questions:[],roles:new Set()});
      const g=groups.get(key);g.rows.push(row.id);g.questions.push(row.event.text);g.roles.add(row.event.type);
    }
    // A real "דבר" recording is required; do not rename an existing greeting.
    if(!groups.has(fold(standard.wake)))groups.set(fold(standard.wake),{key:fold(standard.wake),text:standard.wake,intent:'wake',rows:[],questions:['צינו'],roles:new Set(['opponent','chat'])});
    const items=[...groups.values()].map(g=>({...g,roles:[...g.roles],clipId:library.find(c=>c.ready&&fold(c.text)===g.key)?.id||null,job:this.data.jobs.findLast(j=>j.key===g.key)?.state||null}));
    items.sort((a,b)=>(a.intent==='wake'?-2:a.intent==='wellbeing'?-1:0)-(b.intent==='wake'?-2:b.intent==='wellbeing'?-1:0));
    const missing=items.filter(x=>!x.clipId&&!['queued','submitting','generating','verifying','ready','uncertain','failed','review'].includes(x.job));
    return {items,missing:missing.length,reservationPerClip:1.15,estimatedVideoMaxUSD:Number((missing.length*1.05).toFixed(2)),reservationUSD:Number((missing.length*1.15).toFixed(2)),maxAttemptsPerClip:1,maxSecondsPerAttempt:15,pricePerSecondUSD:.07,pricingDate:'2026-11-09',pricingURL:'https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemini-omni-1-2-flash/',note:'Individual approval only. One generation attempt. Video estimate, not an invoice; validation is billed separately.'};
  }
  status(){return {mode:this.data.autoSession?.enabled?'live_budget':'per_answer_approval',autoSession:this.data.autoSession||null,sessionBudget:this.sessionBudget(),autoQueue:this.data.autoQueue.filter(x=>x.state==='queued').length,price:{perSecondUSD:.07,maxVideoUSD:1.05,reservationUSD:1.15,maxAttempts:1},running:this.running,batch:this.data.batch,jobs:this.data.jobs.map(({id,text,state,error,clipId,created,completed,providerFailure})=>({id,text,state,error,clipId,created,completed,providerFailure})),plan:this.plan()};}
  sessionBudget(){const s=this.data.autoSession;if(!s)return null;const analysisUSD=Math.max(0,this.analysisReserved()-(s.analysisStartUSD??this.analysisReserved()));return {limitUSD:s.limitUSD,videoReservedUSD:s.reservedUSD,analysisReservedUSD:Number(analysisUSD.toFixed(4)),totalReservedUSD:Number((s.reservedUSD+analysisUSD).toFixed(4)),remainingUSD:Number(Math.max(0,s.limitUSD-s.reservedUSD-analysisUSD).toFixed(4)),accounting:"conservative_reservations_not_invoice"};}
  authorizeLive({approved=false,budgetUSD,room,resumeAfterReview=false}){
    if(!approved||![10,15].includes(budgetUSD)||!room)throw new Error('live_budget_approval_required');
    if(this.data.autoSession&&this.data.autoSession.room!==room)throw new Error('live_budget_room_changed');
    if(!this.data.autoSession)this.data.autoSession={id:crypto.randomUUID(),room,limitUSD:budgetUSD,reservedUSD:0,approvedAt:this.now(),enabled:false,error:''};
    const session=this.data.autoSession;session.limitUSD=Math.max(session.limitUSD,budgetUSD);session.analysisStartUSD??=this.analysisReserved();
    if(resumeAfterReview&&session.error){if(this.running||this.autoStarting)throw new Error('live_production_needs_review');session.error='';for(const item of this.data.autoQueue)if(item.state==='queued')item.state='cancelled';}
    this.save();return this.data.autoSession;
  }
  enableLive(room){const s=this.data.autoSession;if(!s||s.room!==room)throw new Error('live_budget_approval_required');if(s.error)throw new Error('live_production_needs_review');s.enabled=true;this.stopped=false;this.save();return s;}
  pauseLive(){if(this.data.autoSession)this.data.autoSession.enabled=false;this.save();}
  reviewCurrent(review,event){
    return !!review&&review.provider==='openai'&&review.eventId===event.id&&review.passes===2&&review.noMatchConfirmed===true&&typeof review.libraryRevision==='string'&&review.libraryRevision===this.director.bankRevision(event)&&Number.isFinite(review.at)&&review.at<=this.now()+2000&&this.now()-review.at<=30000;
  }
  exactRecording(item){
    const library=item.event&&!item.explicit?this.director.eligible(item.event,{semanticReview:true}):this.director.library();
    return library.find(c=>c.ready&&fold(c.text)===fold(item.text)&&performanceMatches(c,item.performanceId));
  }
  bindRecording(item,clip){
    for(const id of item.rows||[]){const row=this.director.saved.inbox.find(r=>r.id===id);if(row?.state==='pending')this.director.resolve({id,action:'bind',clipId:clip.id,learn:!!row.event.uid,reusable:true});}
  }
  releaseUnsubmitted(item){
    if(item.reservationReleased||this.data.jobs.some(j=>j.queueId===item.id&&j.submittedAt))return;
    const session=this.data.autoSession;if(session?.id===item.sessionId){session.reservedUSD=Number(Math.max(0,session.reservedUSD-(item.reservedUSD||0)).toFixed(2));item.reservationReleased=true;}
  }
  attachMeaning(target,rows,questions,roles){
    for(const [key,values] of Object.entries({rows,questions,roles})){target[key]??=[];for(const value of values)if(!target[key].includes(value))target[key].push(value);}
  }
  pendingMeaning(key,except=''){
    if(!key)return null;
    return this.data.autoQueue.find(x=>x.id!==except&&x.semanticKey===key&&['queued','starting'].includes(x.state))||this.data.jobs.find(x=>x.queueId!==except&&x.semanticKey===key&&['queued','submitting','generating','verifying','uncertain'].includes(x.state));
  }
  async refreshQueued(item){
    const ready=this.exactRecording(item);
    if(ready){this.bindRecording(item,ready);item.state='reused';item.clipId=ready.id;this.releaseUnsubmitted(item);return {cached:true,clipId:ready.id};}
    if(item.explicit)return {proceed:true};
    if(item.event.room!==this.director.room){item.state='cancelled';item.error='live_budget_room_changed';this.releaseUnsubmitted(item);return {skipped:true};}
    if(this.reviewCurrent(item.bankReview,item.event))return {proceed:true};
    const event={...item.event},decision=await this.director.choose(event,new AbortController().signal);
    if(this.stopped||!this.data.autoSession?.enabled)throw new Error('production_stopped');
    if(decision.action==='ignore'){item.state='cancelled';item.error='gpt_review_ignored';this.releaseUnsubmitted(item);return {skipped:true};}
    if(decision.action==='play'){
      const clip=this.director.eligible(event,{semanticReview:true}).find(c=>c.ready&&c.id===decision.clipId&&c.text===decision.text);
      if(!clip||decision.confidence<.88)throw new Error('draft_needs_review');
      this.bindRecording(item,clip);item.state='reused';item.clipId=clip.id;this.releaseUnsubmitted(item);return {cached:true,clipId:clip.id};
    }
    const text=String(decision.text||'').trim();
    if(decision.action!=='draft'||!this.reviewCurrent(decision.bankReview,event)||!text||text.length>350||text.split(/\s+/).length>32||!Number.isFinite(decision.confidence)||decision.confidence<.88)throw new Error('gpt_bank_review_required');
    if((item.rows||[]).some(id=>{const r=this.director.saved.inbox.find(r=>r.id===id);return r?.operatorApprovedText&&r.draft!==text;}))throw new Error('draft_needs_review');
    Object.assign(item,{event,text,key:fold(text),intent:eventIntent(event),bankReview:decision.bankReview,semanticKey:semanticGapKey(event,text)});
    const duplicate=this.pendingMeaning(item.semanticKey,item.id)||this.data.jobs.find(j=>j.key===item.key&&j.queueId!==item.id)||this.data.autoQueue.find(j=>j.id!==item.id&&j.key===item.key&&['queued','starting'].includes(j.state));
    if(duplicate){this.attachMeaning(duplicate,item.rows,item.questions,item.roles);item.state='merged';this.releaseUnsubmitted(item);return {skipped:true,merged:true};}
    return {proceed:true};
  }
  offerLive(row,event,decision,{explicit=false,approvedRetry=false}={}){
    const s=this.data.autoSession;
    if(!s||(!s.enabled&&!explicit)||event.room!==s.room||(!explicit&&(!['isolated_audio','tiktools'].includes(event.source)||event.t<s.approvedAt||row.practice)))return {queued:false};
    const review=decision.bankReview;
    if(!explicit&&(decision.action!=='draft'||review?.provider!=='openai'||review.eventId!==event.id||review.passes!==2||!review.noMatchConfirmed))return {queued:false,reason:'gpt_bank_review_required'};
    const text=String((row.operatorApprovedText?row.draft:decision.text)||row.draft||'').trim();
    if(!explicit&&text!==decision.text)return {queued:false,reason:'draft_needs_review'};
    if(!text||text.length>350||text.split(/\s+/).length>32||(!explicit&&(!Number.isFinite(decision.confidence)||decision.confidence<.88)))return {queued:false,reason:'draft_needs_review'};
    const performance=performanceFor(row.performanceId);if(performance&&text!==performance.text)return {queued:false,reason:'performance_text_changed'};
    const intent=eventIntent(event),key=fold(text),existing=(explicit?this.director.library():this.director.eligible(event,{semanticReview:true})).find(c=>c.ready&&fold(c.text)===key&&performanceMatches(c,row.performanceId));
    if(existing){if(row.state==='pending')this.director.resolve({id:row.id,action:'bind',clipId:existing.id,learn:!!event.uid,reusable:true});return {cached:true,clipId:existing.id};}
    if(!explicit&&!this.reviewCurrent(review,event))return {queued:false,reason:'gpt_bank_review_required'};
    const semanticKey=explicit?'':semanticGapKey(event,text);
    const prior=this.data.jobs.filter(j=>j.key===key);
    const retry=explicit&&approvedRetry&&prior.length&&prior.every(j=>j.state==='failed'&&['generation_http_402','generation_auth_failed'].includes(j.error));
    if((prior.length&&!retry)||this.data.autoQueue.some(j=>j.key===key&&(!retry||['queued','starting'].includes(j.state))))return {queued:false,reason:'production_already_submitted'};
    const semanticPrior=!explicit&&this.pendingMeaning(semanticKey);
    if(semanticPrior){this.attachMeaning(semanticPrior,[row.id],[event.text],[event.type]);this.director.record('live_generation_semantic_reuse',{rowId:row.id,existingId:semanticPrior.id});this.save();return {queued:false,merged:true,id:semanticPrior.id,reason:'semantic_production_already_pending'};}
    if(explicit&&approvedRetry&&s.error){
      if(this.running||this.autoStarting)return {queued:false,reason:'production_already_running'};
      if(!['generation_http_402','generation_auth_failed'].includes(s.error))return {queued:false,reason:'live_production_needs_review'};
      for(const x of this.data.autoQueue)if(x.state==='queued')x.state='cancelled';
      this.director.record('explicit_production_retry_authorized',{previousError:s.error,text});s.error='';s.enabled=false;
    }
    if(s.error)return {queued:false,reason:'live_production_needs_review'};
    if((this.sessionBudget()?.totalReservedUSD??s.reservedUSD)+1.15>s.limitUSD+.00001)return {queued:false,reason:'live_budget_exhausted'};
    s.reservedUSD=Number((s.reservedUSD+1.15).toFixed(2));
    const item={id:crypto.randomUUID(),sessionId:s.id,text,key,intent,semanticKey,bankReview:review,rows:[row.id],questions:[event.text],roles:performance?.roles||[event.type],...(performance?{performanceId:performance.id}:{}),event:{...event},state:'queued',reservedUSD:1.15,explicit,created:this.now()};
    this.data.autoQueue.push(item);this.director.record('live_generation_reserved',{sessionId:s.id,text,rowId:row.id,reservedUSD:1.15});this.save();return {queued:true,id:item.id};
  }
  offerOperatorLines(lines){
    if(!Array.isArray(lines)||!lines.length||lines.length>20)throw new Error('invalid_operator_lines');
    const texts=[...new Set(lines.map(x=>typeof x==='string'?x.trim():''))];
    if(texts.some(x=>!x||x.length>350||x.split(/\s+/).length>32||/[\u0000-\u001f]/.test(x)))throw new Error('invalid_operator_lines');
    const session=this.data.autoSession;
    if(!session||session.room!==this.director.room)throw new Error('live_budget_approval_required');
    return texts.map(text=>{
      let row=this.director.saved.inbox.find(r=>r.event.source==='operator_live_lines'&&r.event.room===session.room&&r.draft===text&&r.state==='pending');
      if(!row){const event={id:crypto.randomUUID(),type:'audience',text,source:'operator_live_lines',room:session.room,uid:'',language:'he',t:this.now()};row=this.director.missing(event,{text,confidence:1,reason:'operator_live_line'});row.operatorApprovedText=true;this.director.save();}
      return {text,rowId:row.id,...this.offerLive(row,row.event,{text,confidence:1},{explicit:true})};
    });
  }
  async tickLive(){
    if(this.running||this.autoStarting)return;
    const s=this.data.autoSession;if(!s||s.error)return;
    const item=this.data.autoQueue.find(x=>x.state==='queued'&&x.sessionId===s.id&&(s.enabled||x.explicit));if(!item)return;
    const stopEpoch=this.stopEpoch;this.autoStarting=true;item.state='starting';this.save();
    try{const checked=await this.refreshQueued(item);if(!checked.proceed)return;if(stopEpoch!==this.stopEpoch||item.state!=='starting'||!item.explicit&&(!s.enabled||item.event.room!==this.director.room)){item.state='cancelled';this.releaseUnsubmitted(item);return;}const result=await this.start({approved:true,maxClips:1,budgetUSD:1.15,autoItem:item});if(!result.cached&&!result.skipped)item.state='submitted';}
    catch(e){if(stopEpoch!==this.stopEpoch||e.message==='production_stopped'){item.state='cancelled';this.releaseUnsubmitted(item);}else{item.state='failed';item.error=/^[a-z0-9_]+$/.test(e.message)?e.message:'production_failed';s.error=item.error;s.enabled=false;}}
    finally{this.autoStarting=false;this.save();}
  }
  quote({id,text}){
    const row=this.director.saved.inbox.find(r=>r.id===id&&r.state==='pending');if(!row)throw new Error('pending_item_not_found');
    text=String(text||'').trim();if(!text||text.length>350||/[\u0000-\u001f]/.test(text))throw new Error('invalid_draft');
    const performance=performanceFor(row.performanceId);
    if(performance&&text!==performance.text)throw new Error('performance_text_changed');
    const existing=this.director.library().find(c=>c.ready&&fold(c.text)===fold(text)&&performanceMatches(c,row.performanceId));
    const q={id:crypto.randomUUID(),rowId:id,text,key:fold(text),created:this.now(),expires:this.now()+300000,price:this.status().price,existingClipId:existing?.id||null,
      ...(performance?{performanceId:performance.id,description:performance.description,requestedSeconds:performance.seconds,estimatedVideoUSD:Number((performance.seconds*.07).toFixed(2))}:{})};
    this.data.quotes=this.data.quotes.filter(x=>x.expires>this.now()).slice(-99);this.data.quotes.push(q);this.save();return q;
  }
  async approveQuote({quoteId,approved=false}){
    if(!approved)throw new Error('production_approval_required');const q=this.data.quotes.find(x=>x.id===quoteId);
    if(!q||q.expires<this.now())throw new Error('production_quote_expired');
    if(q.consumed)return {alreadySubmitted:true};
    const row=this.director.saved.inbox.find(x=>x.id===q.rowId&&x.state==='pending');if(!row)throw new Error('pending_item_not_found');
    if((row.performanceId||'')!==(q.performanceId||''))throw new Error('production_quote_changed');
    const existing=this.exactRecording({...q,explicit:true});
    if(existing){q.existingClipId=existing.id;q.consumed=true;this.save();return {cached:true,item:this.director.resolve({id:row.id,action:'bind',clipId:existing.id,learn:!!row.event.uid,reusable:true})};}
    if(q.existingClipId)throw new Error('production_quote_changed');
    if(this.data.jobs.some(j=>j.key===q.key&&['queued','submitting','generating','verifying','uncertain'].includes(j.state)))throw new Error('production_already_submitted');
    q.consumed=true;this.save();
    try{return await this.start({approved:true,maxClips:1,budgetUSD:q.price.reservationUSD,quote:q,row});}
    catch(e){q.consumed=false;this.save();throw e;}
  }
  async start({approved=false,maxClips,budgetUSD,ids,quote,row,autoItem}={}){
    if(!approved)throw new Error('production_approval_required');
    if(this.running)throw new Error('production_already_running');
    if(!Number.isInteger(maxClips)||maxClips<1||maxClips>100||!Number.isFinite(budgetUSD)||budgetUSD<=0||budgetUSD>350)throw new Error('production_limit_required');
    const plan=this.plan(),wanted=autoItem?[autoItem]:quote?[{text:quote.text,key:quote.key,intent:intentOf(row.event.text),rows:[row.id],questions:[row.event.text],roles:performanceFor(quote.performanceId)?.roles||[row.event.type],...(quote.performanceId?{performanceId:quote.performanceId}:{})}]:plan.items.filter(x=>(!ids||x.rows.some(id=>ids.includes(id)))&&!x.clipId&&!x.job);
    const limit=Math.min(maxClips,Math.floor((budgetUSD+.00001)/1.15)),items=wanted.slice(0,limit);
    if(!items.length)throw new Error('production_nothing_within_limit');
    const cached=items.map(item=>({item,clip:this.exactRecording(item)})).filter(x=>x.clip);
    if(cached.length===items.length){for(const {item,clip}of cached){this.bindRecording(item,clip);if(autoItem){autoItem.state='reused';autoItem.clipId=clip.id;this.releaseUnsubmitted(autoItem);}}this.save();return {cached:true,clipId:cached[0].clip.id};}
    // Claim synchronously before awaiting the provider to prevent double clicks.
    this.running=true;this.stopped=false;
    try{await this.preflight();}catch(e){this.running=false;throw e;}
    if(this.stopped||(autoItem&&!autoItem.explicit&&!this.data.autoSession?.enabled)){this.running=false;throw new Error('production_stopped');}
    if(autoItem){try{const checked=await this.refreshQueued(autoItem);if(!checked.proceed){this.running=false;this.save();return checked;}}catch(e){this.running=false;throw e;}}
    const fresh=items.map(item=>({item,clip:this.exactRecording(item)}));
    const remaining=fresh.filter(x=>!x.clip).map(x=>x.item);
    for(const {item,clip}of fresh.filter(x=>x.clip))this.bindRecording(item,clip);
    if(!remaining.length){this.running=false;this.save();return {cached:true,clipId:fresh[0].clip.id};}
    if(quote&&row){row.originalDraft??=row.draft;row.draft=quote.text;row.operatorApprovedText=true;row.productionQuote=quote.id;this.director.record('generation_approved',{quoteId:quote.id,rowId:row.id,text:quote.text,price:quote.price});this.director.save();}
    const batch={id:crypto.randomUUID(),approvedAt:this.now(),maxClips:remaining.length,budgetUSD,reservedUSD:remaining.length*1.15,state:'running'};
    this.data.batch=batch;
    for(const item of remaining)this.data.jobs.push({...item,...(autoItem?{queueId:autoItem.id}:{}),id:crypto.randomUUID(),batchId:batch.id,state:'queued',created:this.now()});
    this.save();this.run().catch(()=>{});return {started:true,batch};
  }
  stop(){this.stopEpoch++;this.stopped=true;this.pauseLive();for(const x of this.data.autoQueue)if(x.state==='queued')x.state='cancelled';if(this.data.batch)this.data.batch.state='stopping';this.save();return {ok:true,note:'The in-flight provider request may finish; no subsequent job starts.'};}
  completeJob(job,c){
    job.clipId=c.id;job.state='ready';job.completed=this.now();delete job.error;
    const interactionMotion=performanceFor(job.performanceId)?.interactionMotion===true||c.motionTemplate===true;
    if(interactionMotion){job.motionTemplate=true;c.motionTemplate=true;}
    const roles=job.intent&&reusableReply(job.intent,c.text)?['chat','opponent']:job.roles;
    this.director.updateClip(c.id,!interactionMotion&&job.event?.source!=='setup',roles);
    for(const id of job.rows){const row=this.director.saved.inbox.find(x=>x.id===id);if(row?.state==='pending')this.director.resolve({id,action:'bind',clipId:c.id,learn:!interactionMotion&&!!row.event.uid,reusable:!interactionMotion});}
    const e={text:job.questions[0],type:roles[0],room:'',uid:'',language:/[\u0590-\u05ff]/.test(c.text)?'he':'en',wakeOnly:job.intent==='wake'};
    if(!interactionMotion)this.director.answerIndex.remember(e,c,{source:'production_verified',reusable:true,persona:this.director.personaKey()});
    this.director.answerIndex.sync(this.director.library());
    this.director.record('production_ready',{job});this.save();
  }
  async recheckEdited({id,generatedId,sha256,editedFile,editedSha256,note}={}){
    if(this.running||this.autoStarting)throw new Error('production_already_running');
    const job=this.data.jobs.find(j=>j.id===id);
    if(!job?.performanceId||job.state!=='failed'||job.error!=='generated_words_review_required'||job.generated?.id!==generatedId||job.localEditReview)throw new Error('local_edit_review_not_eligible');
    if(typeof note!=='string'||note.trim().length<12||note.length>1000||![sha256,editedSha256].every(x=>/^[a-f0-9]{64}$/.test(x||'')))throw new Error('local_edit_review_required');
    if(!this.prepareEdit)throw new Error('local_edit_review_unavailable');
    this.running=true;
    try{
      const decision={generatedId,sha256,editedFile,editedSha256,note:note.trim(),at:this.now()};
      const candidate=await this.prepareEdit(job,decision);
      job.originalGenerated=job.generated;job.originalValidation=job.validation;job.originalTranscript=job.transcript;
      job.generated=candidate;job.localEditReview=decision;job.state='verifying';delete job.review;delete job.transcript;delete job.validation;delete job.error;this.save();
      try{
        const clip=await this.verify(job);if(!clip)throw new Error('production_unverified');
        this.completeJob(job,clip);
      }catch(e){job.state=/timeout|uncertain/.test(e.message)?'uncertain':'failed';job.error=/^[a-z0-9_]+$/.test(e.message)?e.message:'verification_failed';this.save();}
      return {state:job.state,error:job.error||'',generationSubmitted:false};
    }finally{this.running=false;this.director.publish();}
  }
  async approveQualityReview({id,accepted=false,generatedId,sha256,note,releaseSeconds,originX,originY,particleSeconds}={}){
    if(!accepted||typeof note!=='string'||note.trim().length<12||note.length>1000||!/^([a-f0-9]{64})$/.test(sha256||''))throw new Error('quality_review_decision_required');
    if(this.running||this.autoStarting)throw new Error('production_already_running');
    const job=this.data.jobs.find(j=>j.id===id);
    if(!job||job.state!=='failed'||!['generated_quality_review_required','generated_performance_review_required'].includes(job.error)||!job.generated||job.generated.id!==generatedId||!job.review?.identityStable||!Number.isFinite(job.review.score)||job.review.score<7||fold(job.transcript||'')!==fold(job.text))throw new Error('quality_review_not_eligible');
    const cue=validatePerformanceCue(job,{releaseSeconds,originX,originY,particleSeconds});
    if(!this.acceptReview)throw new Error('quality_review_unavailable');
    this.running=true;
    try{
      const decision={accepted:true,generatedId,sha256,note:note.trim(),at:this.now(),originalError:job.error,...(cue||{})};
      const c=await this.acceptReview(job,decision);if(!c)throw new Error('production_unverified');
      job.manualReview=decision;this.completeJob(job,c);
      const s=this.data.autoSession;
      if(s?.id===job.sessionId&&s.error==='generated_quality_review_required'){s.error='';s.enabled=false;}
      for(const x of this.data.autoQueue)if(x.state==='queued')x.state='cancelled';
      this.director.record('production_quality_review_accepted',{jobId:job.id,decision});this.save();
      return {ready:true,clipId:c.id,reusedExistingFile:true};
    }finally{this.running=false;this.director.publish();}
  }
  async run(){
    try{
      for(const job of this.data.jobs.filter(j=>j.batchId===this.data.batch.id&&j.state==='queued')){
        if(this.stopped)break;
        try{
          const existing=this.exactRecording(job);if(existing){job.state='reused';job.clipId=existing.id;this.bindRecording(job,existing);const queued=this.data.autoQueue.find(x=>x.id===job.queueId);if(queued){queued.state='reused';queued.clipId=existing.id;this.releaseUnsubmitted(queued);}this.save();continue;}
          job.state='submitting';job.submittedAt=this.now();this.save();
          await this.submit(job);job.state='generating';this.save();
          const c=await this.verify(job,()=>this.stopped);
          if(!c)throw new Error('production_unverified');
          this.completeJob(job,c);
          const d=this.director,liveEvent=job.event;
          if(!this.stopped&&liveEvent?.type==='opponent'&&d.mode==='auto'&&d.room===liveEvent.room&&d.lastDecision?.event.id===liveEvent.id&&job.rows.includes(d.lastDecision.pendingId)&&d.dialogue?.key===d.dialogueKey(liveEvent)&&this.now()-liveEvent.t<120000&&!d.queue.some(x=>x.type==='opponent')){
            d.queue.unshift({...liveEvent,id:crypto.randomUUID(),originalAt:liveEvent.t,t:this.now(),queuedAt:this.now()});d.lastFinish=0;
          }
        }catch(e){job.state=/uncertain|timeout/.test(e.message)?'uncertain':'failed';job.error=/^[a-z0-9_]+$/.test(e.message)?e.message:'production_failed';this.stopped=true;if(job.sessionId&&this.data.autoSession){this.data.autoSession.error=job.error;this.data.autoSession.enabled=false;}this.save();break;}
      }
    }finally{this.running=false;if(this.data.batch)this.data.batch.state=this.stopped?'stopped':'completed';this.save();this.director.publish();}
  }
}
