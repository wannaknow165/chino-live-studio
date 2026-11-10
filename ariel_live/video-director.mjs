import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { VideoAnswerIndex, intentOf, eventIntent, fold, reusableReply, understandingSchema, validUnderstanding } from './video-answer-index.mjs';

export const normalize = s => String(s || '').normalize('NFKC').replace(/[\u0591-\u05c7]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const clean = (s, max = 1000) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const priority = { opponent: 3, gift: 2, chat: 1, follow: 0, join: 0, audience: -1 };
export const decisionSchema = {
  type: 'object', additionalProperties: false,
  properties: { understanding:understandingSchema, action: { type: 'string', enum: ['play', 'draft', 'ignore'] }, clipId: { type: 'string' }, text: { type: 'string' }, fallbackText:{type:'string'}, confidence: { type: 'number' }, reason: { type: 'string' }, reusable: {type:'boolean'} },
  required: ['understanding','action', 'clipId', 'text','fallbackText', 'confidence', 'reason', 'reusable'],
};
export const participantMemorySchema={type:'object',additionalProperties:false,properties:{summary:{type:'string'},facts:{type:'array',items:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['claimed_name','interest','topic']},value:{type:'string'},quote:{type:'string'}},required:['kind','value','quote']}}},required:['summary','facts']};
decisionSchema.properties.memoryUpdate=participantMemorySchema;
decisionSchema.required.push('memoryUpdate');

// These hints rank retrieval; every automatic answer still needs a fresh GPT
// decision for this event and conversation, including greetings and learned cases.
const greetingInputs = new Set(['שלום', 'היי', 'הי', 'אהלן', 'היי צינו', 'שלום צינו', 'אהלן צינו']);
const neutralGreetings = new Set(['7902c31ae1', '691271ff09', 'c859b83a4a']);
const audienceClips = new Set(['469f030b38','5efc42f2f1','354101c16c','cfefbd805a','21660d985d','809c0f31aa','585b776881','29506af1c3']);
// Existing imported recordings are searchable by the model. Explicit operator
// overrides still win; personal names/gender/context are checked on every turn.
const conversationClips = new Set(['d472599452','15d426e9d6','540576411f','3ac6d757e6','3fa034e318','84c94d49af','faff7d0e72','8251cb25c4','fec2098154','9109ed9ac3','2c1569aad7']);
const giftClips = new Set(['d2f6bb618b']);
const femaleClips=new Set(['d472599452','15d426e9d6','3ac6d757e6','3fa034e318','84c94d49af','faff7d0e72','8251cb25c4','2c1569aad7']);
const operationalClips=new Set(['fec2098154','9109ed9ac3','2c1569aad7']);
const wakeName = "(?:צ['׳’]?ינו|chi+no)";
const wakePrefix = new RegExp('^'+wakeName+'(?=$|[^\\p{L}\\p{N}])', 'iu');
const wakeSpoken = new RegExp('(^|[^\\p{L}\\p{N}])'+wakeName+'(?=$|[^\\p{L}\\p{N}])', 'iu');
const dialogueWindowMs = 120000;
const eventLifetime = e => e.type === 'chat' || e.type === 'gift' ? 300000 : 20000;
export class VideoDirector {
  constructor({ file, catalog, decide, providerStatus, output, emit = () => {}, context = () => ({}), now = Date.now }) {
    Object.assign(this, { file, catalog, decide, providerStatus, output, emit, context, now });
    this.saved = { version: 1, inbox: [], lessons: [], history: [], overrides: {}, people: {}, sessions:[], metrics:[] };
    if (file && fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(saved.inbox) || !Array.isArray(saved.lessons) || !Array.isArray(saved.history)) throw new Error('director_store_invalid');
      Object.assign(this.saved, saved);
    }
    // Always manual after restart: no old event can trigger speech on boot.
    this.mode = 'manual'; this.room = ''; this.queue = []; this.seen = new Map(); this.rate = new Map();
    this.epoch = 0; this.controller = null; this.busy = false; this.active = null;
    this.audioEpoch=0;
    this.lastFinish = 0; this.cooldownMs = 2500; this.repeatMs = 90000;
    this.otherSpeaking = false; this.externalClip = false; this.muted = false;
    this.lastAudienceAttempt = this.now(); this.lastInput = this.now();this.lastInitiativeAttempt=this.now();this.unansweredInitiatives=0;this.lastOpponent=null;
    this.stage = { id: '', seen: 0, ready: false }; this.lastDecision = null;
    this.dialogue = null; this.chatFocus=null; this.lastRouting = null;
    this.preparedChat=new Map();this.chatPreparing=null;
    this.counts = { accepted: 0, filtered: 0, played: 0, missing: 0, expired: 0 };
    this.answerIndex=new VideoAnswerIndex({file:file?path.join(path.dirname(file),'answer-index.json'):undefined,now});
    this.answerIndex.sync(this.library());
    this.journalFile=file?path.join(path.dirname(file),'answers.jsonl'):null;
    if(this.journalFile&&!fs.existsSync(this.journalFile))this.record('import',{history:this.saved.history,inbox:this.saved.inbox,lessons:this.saved.lessons});
  }
  record(kind,data){if(this.journalFile)fs.appendFileSync(this.journalFile,JSON.stringify({kind,at:this.now(),...data})+'\n');}
  personaKey(){return JSON.stringify(this.context().character||{});}
  personKey(e){return JSON.stringify([e.room||'',e.type==='opponent'?'opponent':'viewer',e.uid||'']);}
  participantMemory(e){
    if(!e.uid)return null;const p=this.saved.people[this.personKey(e)];if(!p)return null;
    return {name:p.name,firstSeen:p.firstSeen,visits:p.visits||1,operatorNote:p.operatorNote||'',summary:p.summary||'',summarySource:'model_unverified',facts:(p.facts||[]).slice(-12),recentTurns:(p.turns||[]).slice(-8)};
  }
  updateMemory({key,note}){
    const p=this.saved.people[key];if(!p||typeof note!=='string'||note.length>1000)throw new Error('invalid_participant_memory');
    p.operatorNote=clean(note,1000);p.correctedAt=this.now();this.record('memory_corrected',{key,note:p.operatorNote});this.save();return {saved:true};
  }
  rememberDecision(e,d){
    if(e.uid){const p=this.saved.people[this.personKey(e)];if(p){
      const m=d.memoryUpdate;
      if(m&&typeof m.summary==='string')p.summary=clean(m.summary,700);
      for(const f of (Array.isArray(m?.facts)?m.facts:[]).slice(0,4)){
        // Only a literal quotation from this speaker can support a retained fact.
        if(!['claimed_name','interest','topic'].includes(f?.kind)||typeof f.value!=='string'||typeof f.quote!=='string'||f.quote.length<2||!(e.rawText||e.text).includes(f.quote))continue;
        p.facts??=[];const fact={kind:f.kind,value:clean(f.value,160),quote:clean(f.quote,240),source:'speaker_statement',at:this.now()};
        p.facts=p.facts.filter(x=>!(x.kind===fact.kind&&x.value===fact.value));p.facts.push(fact);p.facts=p.facts.slice(-12);
      }
    }}
    this.saved.metrics.push({at:this.now(),room:e.room,eventId:e.id,source:e.source,type:e.type,action:d.action,ms:d.decisionMs||0,passes:d.bankReview?.passes||0});this.saved.metrics=this.saved.metrics.slice(-1000);this.save();
  }
  startSession(){const session={id:crypto.randomUUID(),room:this.room,startedAt:this.now(),reportState:'pending'};this.saved.sessions.push(session);this.saved.sessions=this.saved.sessions.slice(-50);this.save();return session;}
  learningReport(since=0){
    const rows=this.saved.inbox.filter(r=>!r.practice&&r.created>=since&&r.event.room===this.room&&r.draft&&r.state==='pending');
    const groups=new Map();for(const r of rows){const k=fold(r.event.understanding?.canonicalQuestion||r.event.text);const g=groups.get(k)||{question:r.event.understanding?.canonicalQuestion||r.event.text,count:0,variants:[],draft:r.draft,rowIds:[]};g.count+=(r.variants?.length||1);g.variants=[...new Set([...g.variants,...(r.variants||[r.event.text])])].slice(0,8);g.rowIds.push(r.id);groups.set(k,g);}
    const m=this.saved.metrics.filter(x=>x.at>=since&&x.room===this.room),lat=m.filter(x=>x.action!=='error'&&x.ms>0).map(x=>x.ms).sort((a,b)=>a-b);
    const percentile=q=>lat.length?lat[Math.min(lat.length-1,Math.ceil(lat.length*q)-1)]:null;
    return {since,events:m.length,readyAnswers:m.filter(x=>x.action==='play').length,drafts:m.filter(x=>x.action==='draft').length,errors:m.filter(x=>x.action==='error').length,latency:{p50:percentile(.5),p95:percentile(.95),unit:'ms_decision_only'},gaps:[...groups.values()].sort((a,b)=>b.count-a.count).slice(0,30),latestSession:this.saved.sessions.at(-1)||null};
  }
  isOwnEcho(text){
    const t=fold(text);if(t.split(' ').length<3)return false;
    const recent=[...(this.active?[{text:this.active.text}]:[]),...this.saved.history.filter(h=>h.direction==='out'&&this.now()-h.t<12000).slice(-3)];
    return recent.some(h=>{const a=fold(h.text);return a===t||(t.length>18&&a.includes(t));});
  }
  save() {
    this.saved.inbox = [...this.saved.inbox.filter(x=>x.state!=='pending').slice(-200),...this.saved.inbox.filter(x=>x.state==='pending')]; this.saved.history = this.saved.history.slice(-250);
    if (!this.file) return;
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.saved, null, 2)); fs.renameSync(this.file + '.tmp', this.file);
  }
  library() {
    return this.catalog().map(c => ({ ...c, auto: neutralGreetings.has(c.id)||audienceClips.has(c.id)||conversationClips.has(c.id)||giftClips.has(c.id), roles: giftClips.has(c.id)?['gift']:audienceClips.has(c.id)?['audience']:['chat', 'opponent'], ...this.saved.overrides[c.id], language: /[\u0590-\u05ff]/.test(c.text) ? 'he' : 'en' }));
  }
  stageReady() { return !!(this.stage.ready && this.now() - this.stage.seen < 7000); }
  status() { return { audienceMode:this.saved.audienceMode||'auto',mode: this.mode, room: this.room, queue: this.queue.length, waiting: this.queue.map(e=>({type:e.type,name:e.name,queuedAt:e.queuedAt})), conversation: this.dialogueStatus(), lastRouting: this.lastRouting, busy: this.busy, active: this.active, target: this.active?(this.active.event.type==='opponent'?'opponent':'audience'):null, stage: { ...this.stage, ready: this.stageReady() }, opponentSpeaking: this.otherSpeaking, externalClip: this.externalClip, muted: this.muted, provider: this.providerStatus(), counts: this.counts, lastDecision: this.lastDecision, pending: this.saved.inbox.filter(x => x.state === 'pending').length, lessons: this.saved.lessons.length }; }
  dialogueStatus() {
    if(this.dialogue && this.dialogue.state !== 'speaking' && !(this.dialogue.state==='listening'&&this.otherSpeaking) && this.now() >= this.dialogue.until)this.dialogue=null;
    if(this.chatFocus&&this.now()>=this.chatFocus.until)this.chatFocus=null;
    const focused=this.dialogue||this.chatFocus;
    return {active:!!focused,light:focused?'green':'red',state:focused?.state||'idle',name:focused?.name||'',uid:focused?.uid||'',channel:this.dialogue?'opponent':this.chatFocus?'chat':null,practice:!!focused?.practice,windowSeconds:120,secondsLeft:['waiting','needs_video'].includes(focused?.state)?Math.max(0,Math.ceil((focused.until-this.now())/1000)):null};
  }
  endDialogue() { this.audioEpoch++;this.dialogue=null;this.chatFocus=null; this.publish(); }
  dialogueBlocksAudience() {
    if(!this.dialogue)return false;
    // The recognition window preserves who may reply; it must not monopolize
    // the entire show while that person is silent or a video is being produced.
    return !['waiting','needs_video'].includes(this.dialogue.state)||this.now()<this.dialogue.until-dialogueWindowMs+8000;
  }
  dialogueKey(e) { return JSON.stringify([this.room,e.uid||this.context().opponent?.handle||'isolated-opponent']); }
  setAudienceMode(mode){if(!['auto','solo','battle'].includes(mode))throw new Error('invalid_audience_mode');this.saved.audienceMode=mode;this.chatFocus=null;this.save();this.publish();}
  address(raw, text, uid) {
    const plain=text.normalize('NFKC').replace(/[\u0591-\u05c7]/g,'');
    const prefix=wakePrefix.exec(plain), body=prefix?plain.slice(prefix[0].length).replace(/^[\s,:;.!?־–—-]+/u,'').trim():text;
    if(raw.type==='chat'){this.dialogueStatus();const followup=!!uid&&this.chatFocus?.uid===uid&&this.chatFocus.room===this.room;const context=this.context(),mode=this.saved.audienceMode||'auto',solo=mode==='solo'||mode==='auto'&&!context.opponent?.handle&&!context.battle;if(!prefix&&!followup&&!solo)return null;return {text:body||'שלום',wakeOnly:!!prefix&&!body,addressedBy:prefix?'chat_name_prefix':followup?'chat_conversation_followup':'solo_chat'};}
    if(raw.type!=='opponent')return {text,addressedBy:'event'};
    if(raw.source==='director_cadence')return {text,addressedBy:'host_initiative',dialogue:{key:this.dialogueKey({uid}),uid,name:clean(raw.name,80),practice:false,state:'responding',until:this.now()+dialogueWindowMs}};
    this.lastInput=this.now(); this.dialogueStatus();
    const key=this.dialogueKey({uid}), called=wakeSpoken.test(plain), practice=['microphone','practice_audio'].includes(raw.source);
    if(!called&&this.dialogue?.key!==key&&!practice)return null;
    return {text:body||'שלום',wakeOnly:!!prefix&&!body,addressedBy:called?'spoken_name':practice&&this.dialogue?.key!==key?(raw.source==='practice_audio'?'recorded_audio_practice':'microphone_practice'):'conversation_followup',
      dialogue:{key,uid,name:clean(raw.name,80)||this.dialogue?.name||'',practice,state:'responding',until:this.now()+dialogueWindowMs}};
  }
  publish() { this.emit('director', this.status()); }
  cancel(reason, stop = true, keepAudience = false) {
    this.epoch++; this.controller?.abort(); this.controller = null; this.queue = keepAudience?this.queue.filter(e=>e.type==='chat'||e.type==='gift'):[];
    if (this.active && stop) this.output('cancel', { playId: this.active.playId, reason });
    this.active = null; this.publish();
  }
  setMode(mode) { if (!['manual', 'rehearsal', 'auto'].includes(mode)) throw new Error('invalid_mode'); this.chatPreparing?.controller.abort();this.preparedChat.clear();this.audioEpoch++;this.cancel('mode_changed'); this.dialogue=null;this.chatFocus=null; this.mode = mode; this.publish(); }
  setRoom(room) { room = clean(room, 100); if (room !== this.room) { this.chatPreparing?.controller.abort();this.preparedChat.clear();this.audioEpoch++;this.cancel('room_changed'); this.dialogue=null;this.chatFocus=null;this.lastOpponent=null;this.unansweredInitiatives=0; this.room = room; this.lastDecision = null; this.otherSpeaking = false; this.seen.clear(); this.rate.clear(); this.publish(); } }
  hold(kind, on) {
    if (!['otherSpeaking', 'externalClip', 'muted'].includes(kind)) throw new Error('invalid_hold');
    this.dialogueStatus();
    // The two-minute window is a deadline to START replying, not to finish speaking
    // or to finish local transcription. Never interrupt an utterance at zero.
    if(kind==='otherSpeaking'&&this.dialogue){
      if(on){this.dialogue.state='listening';this.dialogue.until=this.now()+dialogueWindowMs;}
      else if(this[kind]){this.dialogue.state='transcribing';this.dialogue.until=this.now()+dialogueWindowMs;}
    }
    if (on && !this[kind]) this.cancel(kind,true,kind==='otherSpeaking');
    this[kind] = !!on; this.publish();
  }
  heartbeat({ id, ready }) {
    id = clean(id, 100); if (!id) throw new Error('stage_id_required');
    // An embedded silent preview can never own output. One audible stage only.
    if (this.stage.id && id !== this.stage.id && this.now() - this.stage.seen < 7000) return { owner: false };
    if (id !== this.stage.id && this.active) this.cancel('stage_changed');
    this.stage = { id, ready: ready === true, seen: this.now() }; return { owner: true, ...this.status() };
  }
  receive(raw) {
    if (!raw || !Object.hasOwn(priority, raw.type)) return this.filtered('unsupported_event');
    if (raw.source === 'observed_stream' || raw.speaker === 'UNKNOWN') return this.filtered('unidentified_speaker');
    const t = Number(raw.t ?? this.now());
    if (!Number.isFinite(t) || t > this.now() + 2000 || this.now() - t > 20000) return this.filtered('expired_event');
    const rawText = clean(raw.text);
    if (rawText.length < 2 || !/[\p{L}\p{N}]/u.test(rawText) || /(.)\1{12,}/u.test(rawText) || /https?:\/\/|www\./i.test(rawText)) return this.filtered('spam');
    const uid = clean(raw.uid, 100), personKey = JSON.stringify([this.room, raw.type === 'opponent' ? 'opponent' : 'viewer', uid]);
    const routing=this.address(raw,rawText,uid);
    this.lastRouting={type:raw.type,accepted:!!routing,reason:routing?.addressedBy||(raw.type==='chat'?'chat_name_required':'waiting_for_name'),at:this.now()};
    if(!routing)return this.filtered(this.lastRouting.reason);
    const text=routing.text,language=/[\u0590-\u05ff]/.test(text)?'he':'en';
    const known = uid ? this.saved.people[personKey] : null;
    const e = { id: clean(raw.id || crypto.randomUUID(), 160), type: raw.type, text, rawText, wakeOnly:!!routing.wakeOnly, addressedBy:routing.addressedBy, language, uid, name: clean(raw.name || known?.name, 80), t, queuedAt:this.now(), room: this.room, source: clean(raw.source || 'operator_test', 40),hostInitiated:raw.source==='director_cadence',...(raw.source==='practice_audio'?{fixtureId:clean(raw.fixtureId,100)}:{}) };
    const keys = ['id:' + e.id, ...(e.hostInitiated?[]:[`${e.type}:${e.uid}:${normalize(text)}`])];
    for (const [k, at] of this.seen) if (this.now() - at > 60000) this.seen.delete(k);
    if (keys.some(k => this.seen.has(k)&&(!e.wakeOnly||k.startsWith('id:')||this.now()-this.seen.get(k)<2000))) return this.filtered('duplicate');
    const rk = e.type + ':' + (e.uid || 'anonymous');
    for (const [k, times] of this.rate) if (!times.some(x => this.now() - x < 15000)) this.rate.delete(k);
    const recent = (this.rate.get(rk) || []).filter(x => this.now() - x < 15000);
    if (recent.length >= (e.type === 'opponent'||e.type==='chat'&&this.chatFocus?.uid===e.uid ? 6 : 3)) return this.filtered('rate_limited');
    if(e.type==='opponent'&&!e.hostInitiated){this.lastOpponent=e;this.unansweredInitiatives=0;}
    if(routing.dialogue)this.dialogue={...routing.dialogue,name:e.name};
    keys.forEach(k => this.seen.set(k, this.now())); this.rate.set(rk, [...recent, this.now()]);
    if (uid) {
      const previous=known||{};
      this.saved.people[personKey] = { ...previous, uid, name: e.name, room:this.room, role:e.type==='opponent'?'opponent':'viewer', lastSeen: this.now(), firstSeen: known?.firstSeen || this.now(),visits:(previous.visits||0)+(this.now()-(previous.lastSeen||0)>1800000?1:0)||1,turns:[...(previous.turns||[]),{direction:'in',text:e.text,at:this.now()}].slice(-16) };
      const people = Object.entries(this.saved.people).sort((a,b) => b[1].lastSeen-a[1].lastSeen).slice(0,1000); this.saved.people = Object.fromEntries(people);
    }
    this.saved.history.push({ ...e, direction: 'in' }); this.record('heard',{event:e}); this.save(); this.counts.accepted++;
    if(e.type!=='audience')this.lastInput=this.now();
    if (this.mode === 'manual') { this.publish(); return { accepted: true, mode: 'manual', id: e.id }; }
    // A newer opponent turn invalidates an earlier unspoken answer.
    if (e.type === 'opponent') {
      if (this.active) this.cancel(this.active.event.type==='opponent'?'opponent_interrupts':'opponent_takes_turn',true,true);
      if (this.busy && !this.active) { this.epoch++; this.controller?.abort(); }
      this.queue = this.queue.filter(x => x.type !== 'opponent');
    }
    // One waiting chat turn per stable viewer; a correction keeps their place.
    const prior=e.type==='chat'&&e.uid?this.queue.find(x=>x.type==='chat'&&x.uid===e.uid):null;
    if(prior){e.queuedAt=prior.queuedAt;this.queue=this.queue.filter(x=>x!==prior);}
    if(this.queue.length>=12){
      if(e.type==='opponent')this.missing(this.queue.pop(),{text:'',reason:'conversation_queue_full'});
      else {this.missing(e,{text:'',reason:'conversation_queue_full'});return {accepted:true,queued:false,reason:'conversation_queue_full'};}
    }
    this.queue.push(e); this.queue.sort((a, b) => priority[b.type] - priority[a.type] || a.queuedAt - b.queuedAt);
    this.publish(); return { accepted: true, id: e.id };
  }
  filtered(reason) { this.counts.filtered++; return { accepted: false, reason }; }
  canSpeak() { return !this.otherSpeaking && !this.externalClip && !this.muted && this.context().videoMode !== false; }
  eligible(e, {semanticReview=false}={}) {
    const approved = c => this.saved.lessons.some(l => l.room === e.room && l.uid === e.uid && l.type === e.type && l.trigger === normalize(e.text) && l.clipId === c.id && l.recordedText === c.text);
    return this.library().filter(c => c.ready && !c.motionTemplate && ((c.auto && c.roles.includes(e.type)) || approved(c)) && c.language === e.language &&
      (approved(c)||(!femaleClips.has(c.id)||e.type==='opponent'&&this.context().opponent?.verifiedGender==='female')&&!operationalClips.has(c.id)&&c.id!=='3ac6d757e6')&&
      (semanticReview||approved(c)||!['wellbeing','identity','thanks'].includes(eventIntent(e))||reusableReply(eventIntent(e),c.text))&&
      (semanticReview||!neutralGreetings.has(c.id) || greetingInputs.has(normalize(e.text)) || eventIntent(e)==='greeting' || approved(c)) &&
      (semanticReview||(e.wakeOnly&&(neutralGreetings.has(c.id)||fold(c.text)==='דבר'))||(['wellbeing','identity'].includes(eventIntent(e))&&reusableReply(eventIntent(e),c.text))||!this.saved.history.some(h => h.direction === 'out' && h.clipId === c.id && this.now() - h.t < this.repeatMs)));
  }
  bankRevision(event){
    const inventory=this.eligible(event,{semanticReview:true}).map(c=>[c.id,c.text,c.file,c.language]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
    return crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
  }
  learned(e, candidates) {
    return this.saved.lessons.findLast(l => l.room === e.room && l.uid === e.uid && l.type === e.type && l.trigger === normalize(e.text) &&
      candidates.some(c => c.id === l.clipId && c.text === l.recordedText));
  }
  async choose(e, signal) {
    this.answerIndex.sync(this.library());
    e.understanding=this.answerIndex.understand(e,this.personaKey());
    const provider=this.providerStatus();
    if (!provider.configured || provider.blocked) throw new Error('openai_unavailable_operator_required');
    const libraryRevision=this.bankRevision(e);
    const reviewedCandidates=this.answerIndex.rank(e,this.eligible(e,{semanticReview:true})).map(c=>{
      const last=this.saved.history.findLast(h=>h.direction==='out'&&h.room===e.room&&h.clipId===c.id);
      const lastPlayedAgoMs=last?Math.max(0,this.now()-last.t):null;
      return {...c,lastPlayedAgoMs,cooldownRemainingMs:last?Math.max(0,this.repeatMs-lastPlayedAgoMs):0};
    });
    e.searchedClips=reviewedCandidates.length;
    // Local indexing and corrections are retrieval hints, never permission to
    // play. Include every eligible recording, not just exact keyword matches.
    const packet={ event: e, requiredReplyLanguage:e.language, context: this.context(), participantMemory:this.participantMemory(e), history: this.saved.history.filter(h => h.room === this.room && h.uid===e.uid).slice(-18),
      candidates:reviewedCandidates, languageExamples:this.answerIndex.languageExamples(e,this.personaKey()), examples: this.saved.lessons.filter(l => l.room === e.room && l.uid === e.uid).slice(-12),
      approvedTextPatterns: this.saved.inbox.filter(r => r.operatorApprovedText && r.event.room===e.room && r.event.type === e.type && (!r.event.uid || r.event.uid === e.uid)).slice(-12).map(r => ({question:r.event.text,answer:r.draft,videoReady:false})) };
    const validate=d=>{
      if(!d||!['play','draft','ignore'].includes(d.action)||!Number.isFinite(d.confidence)||d.confidence<0||d.confidence>1||typeof d.text!=='string')throw new Error('invalid_decision');
      if(d.understanding&&!validUnderstanding(d.understanding))throw new Error('decision_invalid_understanding');
      if(d.action==='play'&&!reviewedCandidates.some(c=>c.id===d.clipId&&c.text===d.text))throw new Error('decision_invalid_clip');
      if(d.action==='draft'&&!String(d.text||d.fallbackText||'').trim())throw new Error('decision_empty_draft');
      return d;
    };
    const questionOnly=d=>eventIntent({...e,understanding:e.understanding?.source==='operator'?e.understanding:d.understanding||e.understanding})==='wellbeing'&&d.action!=='ignore'&&
      (d.action==='play'&&neutralGreetings.has(d.clipId)||/^(?:(?:וואלה|היי|אהלן) )?(?:מה נשמע|מה שלומך|מה קורה|מה איתך)(?: אחי| אח שלי| מלך)?$/u.test(fold(d.text||d.fallbackText)));
    const wrongPerson=d=>d.action==='play'&&reusableReply('identity',d.text)&&/(?:איך קוראים לי|מה השם שלי|what is my name)/u.test(fold(e.text));
    const wrongLanguage=d=>d.action==='draft'&&e.language==='en'&&/[\u0590-\u05ff]/.test(d.text||d.fallbackText||'')&&!/[a-z]/i.test(d.text||d.fallbackText||'');
    let d=await this.decide({...packet,reviewStage:'select_existing'},signal);
    if(signal?.aborted)return d;
    validate(d);
    let passes=1;
    if(d.action==='draft'||questionOnly(d)||wrongPerson(d)||wrongLanguage(d)){
      // A second GPT pass must confirm there really is no suitable recording
      // before a missing answer is eligible for automatic paid production.
      const rejection=questionOnly(d)?'question_instead_of_answer':wrongPerson(d)?'wrong_person_name':wrongLanguage(d)?'wrong_reply_language':null;
      if(rejection)this.record('choice_recheck',{eventId:e.id,clipId:d.clipId,reason:rejection});
      d=await this.decide({...packet,reviewStage:'before_new_video',proposedDecision:d,validationFeedback:rejection},signal);
      if(signal?.aborted)return d;
      validate(d);passes++;
    }
    if(wrongLanguage(d))throw new Error('decision_language_mismatch');
    if(d.understanding&&e.understanding?.source!=='operator')e.understanding={...d.understanding,source:'model'};
    if(d.action==='play'&&!this.eligible(e,{semanticReview:true}).some(c=>c.id===d.clipId&&c.text===d.text))throw new Error('decision_clip_changed');
    // Catch an obvious question-only response without requiring all legitimate
    // answers to match our small list of canned phrases. Failure is not a gap.
    if(questionOnly(d))throw new Error('decision_question_not_answer');
    if(wrongPerson(d))throw new Error('decision_wrong_person');
    // Keep GPT's wording. A regex must not silently replace it with a canned line.
    if(d.action==='draft')d={...d,clipId:'',text:clean(d.text||d.fallbackText,350)};
    let matchedClipId=d.action==='play'?d.clipId:null,cooldownRemainingMs=0;
    if(d.action==='play'){
      const c=reviewedCandidates.find(c=>c.id===d.clipId),approved=this.learned(e,[c]);
      const repeatExempt=approved||(e.wakeOnly&&(neutralGreetings.has(c.id)||fold(c.text)==='דבר'))||(['wellbeing','identity'].includes(eventIntent(e))&&reusableReply(eventIntent(e),c.text));
      if(!repeatExempt){const last=this.saved.history.findLast(h=>h.direction==='out'&&h.room===e.room&&h.clipId===c.id);cooldownRemainingMs=last?Math.max(0,this.repeatMs-(this.now()-last.t)):0;}
      if(cooldownRemainingMs>0)d={...d,action:'ignore',clipId:'',text:'',fallbackText:'',reusable:false,reason:'existing_answer_cooldown'};
    }
    return {...d,bankReview:{provider:'openai',model:provider.model||'',eventId:e.id,passes,libraryRevision,candidateCount:reviewedCandidates.length,
      candidateIds:reviewedCandidates.map(c=>c.id),matchedClipId,cooldownRemainingMs,noMatchConfirmed:d.action==='draft'&&passes===2,at:this.now()}};
  }
  correctUnderstanding({eventId,canonicalQuestion}){
    const e=this.lastDecision?.event;
    if(!e||e.id!==eventId||e.room!==this.room)throw new Error('understanding_event_changed');
    const question=clean(canonicalQuestion,500);if(!question)throw new Error('understanding_required');
    const intent=intentOf(question)||'other',u={intent,canonicalQuestion:question,confidence:1,standalone:intent!=='other'};
    this.answerIndex.rememberUnderstanding(e,u,{persona:this.personaKey(),source:'operator'});
    this.record('understanding_corrected',{event:e,understanding:u});
    this.cancel('understanding_corrected',true,true);
    const retry={...e,id:crypto.randomUUID(),t:this.now(),queuedAt:this.now()};
    this.queue.unshift(retry);this.lastFinish=0;
    if(e.type==='opponent')this.dialogue={key:this.dialogueKey(e),uid:e.uid,name:e.name,practice:['microphone','practice_audio'].includes(e.source),state:'responding',until:this.now()+dialogueWindowMs};
    this.publish();return {saved:true,queued:this.mode!=='manual',eventId:retry.id};
  }
  missing(e, d, reason = d.reason) {
    this.record('missing',{event:e,decision:d,reason});
    if(e.type==='opponent'&&this.dialogue?.key===this.dialogueKey(e)){this.dialogue.state='needs_video';this.dialogue.until=this.now()+dialogueWindowMs;}
    const intent=eventIntent(e),prior=String(e.id||'').startsWith('practice-')?null:this.saved.inbox.findLast(r=>r.state==='pending'&&!r.practice&&r.event.room===e.room&&r.event.type===e.type&&r.event.uid===e.uid&&r.event.language===e.language&&((intent&&eventIntent(r.event)===intent)||fold(r.event.text)===fold(e.text)));
    if(prior){
      prior.variants=[...new Set([...(prior.variants||[prior.event.text]),e.text])];prior.updated=this.now();
      const priorWrongLanguage=e.language==='en'&&/[\u0590-\u05ff]/.test(prior.draft)&&!/[a-z]/i.test(prior.draft),freshEnglish=/[a-z]/i.test(d.text||'');
      if(!prior.operatorApprovedText&&((priorWrongLanguage&&freshEnglish)||(e.understanding&&intent&&!reusableReply(intent,prior.draft)&&reusableReply(intent,d.text)))){
        prior.draftRevisions??=[];prior.draftRevisions.push({text:prior.draft,reason:prior.reason,at:this.now()});prior.draft=clean(d.text,350);prior.reason=clean(reason,160);
      }
      this.save();this.emit('director-inbox',{item:prior,event:e,decision:d});return prior;
    }
    const row = { id: crypto.randomUUID(), event: e, draft: clean(d.text, 350), proposedClipId: clean(d.clipId, 100), reason: clean(reason, 160), state: 'pending', created: this.now(), videoReady: false };
    this.saved.inbox.push(row); this.counts.missing++; this.save(); this.emit('director-inbox', { item: row,event:e,decision:d }); return row;
  }
  chatContextKey(){return JSON.stringify([this.room,this.personaKey(),this.context(),this.saved.history.slice(-12),this.library().map(c=>[c.id,c.text,c.ready,c.auto,c.roles])]);}
  async prepareChat(){
    if(this.mode!=='auto'||this.chatPreparing)return;
    const e=this.queue.find(x=>x.type==='chat'&&!this.preparedChat.has(x.id)&&this.now()-x.t<eventLifetime(x));if(!e)return;
    const room=this.room,key=this.chatContextKey(),controller=new AbortController();this.chatPreparing={id:e.id,controller};
    try{
      const d=await this.choose(e,controller.signal);
      if(this.mode!=='auto'||this.room!==room||!this.queue.some(x=>x.id===e.id)||this.now()-e.t>=eventLifetime(e))return;
      if(!d||!['play','draft','ignore'].includes(d.action)||!Number.isFinite(d.confidence))return;
      this.preparedChat.set(e.id,{decision:d,key});
      this.record('chat_prepared',{event:e,decision:d});
      if(d.action==='draft')this.missing(e,d);
    }catch{this.preparedChat.set(e.id,{failed:true});}finally{this.chatPreparing=null;for(const id of this.preparedChat.keys())if(!this.queue.some(x=>x.id===id))this.preparedChat.delete(id);}
  }
  async tick() {
    this.dialogueStatus();
    if (this.active) {
      if (!this.stageReady() || this.now() > this.active.deadline) {
        const a = this.active; this.cancel('playback_not_confirmed'); this.mode = 'manual';
        this.missing(a.event, { text: '', clipId: a.clipId }, 'playback_not_confirmed'); this.dialogue=null; this.publish();
      }
      return;
    }
    if (this.mode === 'manual' || this.busy || !this.canSpeak() || this.now() - this.lastFinish < this.cooldownMs) return;
    if (this.mode === 'auto' && (this.now()<(this.showHoldUntil||0)||!this.stageReady())) return;
    const fresh = this.queue.filter(e => this.now() - e.t < eventLifetime(e)); this.counts.expired += this.queue.length - fresh.length; this.queue = fresh;
    const context=this.context(),audience=context.audienceConnection;
    if(!this.queue.length&&this.mode==='auto'&&this.now()-this.lastInitiativeAttempt>=18000&&this.now()-this.lastInput>=6500&&this.now()-this.lastFinish>=8000&&!this.dialogueBlocksAudience()){
      const partner=this.lastOpponent||context.opponent,withOpponent=this.saved.audienceMode!=='solo'&&(!!partner?.uid||!!partner?.handle||!!context.battle||this.saved.audienceMode==='battle');
      if(withOpponent&&this.unansweredInitiatives<2&&this.dialogue?.state!=='needs_video'){
        this.lastInitiativeAttempt=this.now();this.unansweredInitiatives++;
        const en=partner?.language==='en',attempt=this.unansweredInitiatives;this.receive({type:'opponent',uid:partner?.uid||partner?.handle||'isolated-opponent',name:partner?.name||'',text:en?`Approach ${attempt}: `+'There is a quiet gap. Initiate one short friendly question to the opposing player about their day, name, or a game. Do not claim they said anything. Avoid repeating unanswered questions.':`פנייה ${attempt}: `+'יש מרווח שקט. פתח מיוזמתך שאלה קצרה וחברותית למתמודד: איך עובר היום, היכרות או הצעה למשחק. אל תטען שהוא אמר משהו ואל תחזור על שאלה שלא נענתה.',source:'director_cadence'});
      }else if(audience?.on){
        this.lastAudienceAttempt=this.lastInitiativeAttempt=this.now();
        this.receive({type:'audience',text:'יש מרווח בשיחה. פנה בקצרה לקהל באווירה טובה. אם שאלה קודמת לא נענתה, אל תחזור עליה: בחר משפט מעבר חם או הומור קצר ואז תן מקום לתגובה.',source:'director_cadence'});
      }
    }
    if(this.dialogueBlocksAudience()&&this.queue[0]?.type!=='opponent'&&!this.queue[0]?.hostInitiated)return;
    const e = this.queue.shift(); if (!e) return;
    const epoch = this.epoch, controller = new AbortController(); this.controller = controller; this.busy = true;
    const start = this.now();
    try {
      const prepared=this.preparedChat.get(e.id);this.preparedChat.delete(e.id);
      const d = prepared?.decision&&prepared.key===this.chatContextKey()?prepared.decision:await this.choose(e, controller.signal);
      if (epoch !== this.epoch || this.mode === 'manual' || !this.canSpeak() || this.now() - e.t >= eventLifetime(e)) return;
      if (!d || !['play', 'draft', 'ignore'].includes(d.action) || !Number.isFinite(d.confidence) || typeof d.text !== 'string') throw new Error('invalid_decision');
      if(e.understanding?.source==='model')this.answerIndex.rememberUnderstanding(e,e.understanding,{persona:this.personaKey()});
      this.lastDecision = { ...d, understanding:e.understanding, event: e, target:e.type==='opponent'?'opponent':'audience', decided: this.now(), decisionMs: this.now() - start, rehearsal: this.mode === 'rehearsal' };
      this.record('decision',this.lastDecision);
      this.rememberDecision(e,this.lastDecision);
      if (d.action === 'ignore') { this.counts.filtered++; if(e.type==='opponent'&&this.dialogue?.key===this.dialogueKey(e)){this.dialogue.state='waiting';this.dialogue.until=this.now()+dialogueWindowMs;} return; }
      const c = this.eligible(e,{semanticReview:true}).find(c => c.id === d.clipId);
      if (d.action !== 'play' || !c || c.text !== d.text || d.confidence < 0.88) { const row=this.missing(e, d, d.action === 'play' ? 'uncertain_or_invalid_clip' : d.reason);Object.assign(this.lastDecision,{action:'draft',clipId:'',pendingId:row.id,text:row.draft,reason:row.reason}); return; }
      this.answerIndex.remember(e,c,{reusable:d.reusable===true,persona:this.personaKey(),source:d.reason==='operator_approved_exact_case'?'operator':'model'});
      if (this.mode === 'rehearsal') {
        if(e.type==='opponent'&&this.dialogue?.key===this.dialogueKey(e)){this.dialogue.state='waiting';this.dialogue.until=this.now()+dialogueWindowMs;}
        return;
      }
      this.play(c, e);
    } catch (err) {
      if (epoch === this.epoch && !controller.signal.aborted) {
        const reason=/^openai_|^local_rate|^budget_|^decision_|^invalid_decision/.test(err.message)?err.message:'decision_failed';
        this.lastDecision={action:'error',text:'',clipId:'',event:e,understanding:e.understanding,reason,decided:this.now(),decisionMs:this.now()-start};
        this.record('decision_error',this.lastDecision);
        this.rememberDecision(e,this.lastDecision);
        if(this.dialogue?.key===this.dialogueKey(e)){this.dialogue.state='waiting';this.dialogue.until=this.now()+dialogueWindowMs;}
      }
    } finally { this.busy = false; if (this.controller === controller) this.controller = null; this.lastFinish = this.now(); this.publish(); }
  }
  play(c, e, options = {}) {
    if (!this.stageReady() || !this.canSpeak() || this.active) throw new Error('stage_not_available');
    // Interaction metadata is local, pre-reviewed compositing data, never a model
    // supplied arbitrary play payload. Ordinary speech keeps its existing lease.
    const interaction = options.interactionScene !== undefined;
    if (interaction && (typeof options.interactionScene !== 'string' || !/^\/media\/interactions\/scenes\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.json$/.test(options.interactionScene) || options.interactionScene.includes('..') || options.repeatCount !== 2 || !Number.isFinite(options.expectedDuration) || options.expectedDuration <= 0 || options.expectedDuration > 90)) throw new Error('invalid_interaction_play_metadata');
    const metadata = interaction ? { interactionScene: options.interactionScene, repeatCount: 2, expectedDuration: options.expectedDuration } : {};
    const expires = this.now() + (interaction ? 15000 : 6000);
    const playId = crypto.randomUUID();
    this.active = { playId, clipId: c.id, text: c.text, event: e, sent: this.now(), started: 0, deadline: expires, stageId: this.stage.id, ...metadata };
    this.output('play', { playId, clipId: c.id, text: c.text, file: c.file, stageId: this.stage.id, expires, ...metadata }); this.publish();
  }
  playback({ stageId, playId, state, duration }) {
    const a = this.active;
    if (!a || a.playId !== playId || a.stageId !== stageId || !this.stageReady()) return { accepted: false };
    if (state === 'started' && !a.started) {
      if(a.event.type==='chat'&&a.event.uid)this.chatFocus={uid:a.event.uid,name:a.event.name,room:this.room,state:'speaking',until:this.now()+dialogueWindowMs};
      if(a.event.type==='opponent'&&this.dialogue?.key===this.dialogueKey(a.event))this.dialogue.state='speaking';
      a.started = this.now(); a.deadline = this.now() + Math.min(90000, Math.max(5000, Number(duration) * 1000 || 15000)) + 3000;
      this.saved.history.push({ direction: 'out', room: this.room, text: a.text, clipId: a.clipId, eventId: a.event.id, uid: a.event.uid, t: this.now() }); this.save();
      const person=this.saved.people[this.personKey(a.event)];if(person){person.turns=[...(person.turns||[]),{direction:'out',text:a.text,at:this.now()}].slice(-16);this.save();}
      this.record('played',{event:a.event,clipId:a.clipId,text:a.text});
      this.counts.played++; this.emit('director-spoken', { text: a.text, event: a.event, clipId: a.clipId });
    } else if (state === 'ended' && a.started) { this.active = null; this.lastFinish = this.now();
      if(a.event.type==='chat'&&this.chatFocus?.uid===a.event.uid){this.chatFocus.state='waiting';this.chatFocus.until=this.now()+dialogueWindowMs;}
      if(a.event.type==='opponent'&&this.dialogue?.key===this.dialogueKey(a.event)){this.dialogue.state='waiting';this.dialogue.until=this.now()+dialogueWindowMs;}
    }
    else if (['failed', 'interrupted'].includes(state)) {
      this.active = null; this.mode = 'manual'; this.missing(a.event, { text: '', clipId: a.clipId }, 'playback_' + state);
      this.dialogue=null;this.chatFocus=null;
    }
    if (['started', 'ended', 'failed', 'interrupted'].includes(state)) this.emit('director-playback', { stageId, playId, state, ...(Number.isFinite(duration) ? {duration} : {}) });
    this.publish(); return { accepted: true };
  }
  updateClip(id, auto, roles) {
    const c = this.library().find(c => c.id === id); if (!c) throw new Error('clip_not_found');
    if (!Array.isArray(roles) || !roles.length || roles.some(r => !Object.hasOwn(priority, r))) throw new Error('invalid_roles');
    this.saved.overrides[id] = { auto: auto === true, roles: [...new Set(roles)] }; this.save(); this.publish();
  }
  resolve({ id, action, clipId, draft, learn = false, responseAction, reusable=false }) {
    const row = this.saved.inbox.find(x => x.id === id && x.state === 'pending'); if (!row) throw new Error('pending_item_not_found');
    if (action === 'dismiss') row.state = 'dismissed';
    else if(action==='production_exclude')row.productionExcluded=true;
    else if (action === 'draft' || action === 'review_draft') {
      const text=clean(draft,350);
      if(!text && !(action==='review_draft'&&['listen','ignore'].includes(responseAction)))throw new Error('empty_draft');
      if(action==='review_draft'&&row.practice){if(!['answer','listen','ignore'].includes(responseAction))throw new Error('invalid_response_action');row.originalDraft??=row.draft;row.practice.action=responseAction;row.assistantReviewed=true;}
      row.draft=text;row.reason=action==='draft'?'operator_draft_video_missing':'reviewed_draft_video_missing';row.operatorApprovedText=action==='draft';
    }
    else if (action === 'bind' || action === 'play') {
      if (learn && !row.event.uid) throw new Error('stable_participant_id_required_for_learning');
      const c = this.library().find(c => c.id === clipId && c.ready); if (!c) throw new Error('clip_not_ready');
      if (action === 'play') { this.cancel('operator_override'); this.play(c, { ...row.event, t: this.now() }); }
      row.state = 'resolved'; row.clipId = c.id; row.videoReady = true; row.recordedText = c.text;
      this.answerIndex.remember(row.event,c,{source:'operator',reusable,persona:this.personaKey()});
      if (learn) {
        this.saved.lessons.push({ trigger: normalize(row.event.text), type: row.event.type, room: row.event.room, uid: row.event.uid,
          clipId: c.id, recordedText: c.text, approved: this.now(), source: 'operator_correction' });
      }
    } else throw new Error('invalid_resolution');
    row.updated = this.now(); this.record('resolved',{row,action}); this.save(); this.publish(); return row;
  }
  operatorSay(text) {
    text = clean(text, 350); if (!text) throw new Error('empty_text');
    this.cancel('operator_override');
    const c = this.library().find(c => c.ready && normalize(c.text) === normalize(text));
    const e = { id: crypto.randomUUID(), type: 'opponent', text: 'אמור: ' + text, uid: '', name: '', room: this.room, t: this.now(), source: 'operator', language: /[\u0590-\u05ff]/.test(text) ? 'he' : 'en' };
    if (c) { this.play(c, e); return { ready: true, clipId: c.id }; }
    return { ready: false, item: this.missing(e, { text, clipId: '', reason: 'operator_draft_video_missing' }) };
  }
}
