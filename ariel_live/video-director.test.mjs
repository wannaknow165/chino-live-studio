import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VideoDirector } from './video-director.mjs';
import { VideoDecisionProvider } from './video-director-provider.mjs';
import { Budget } from './performer-core.mjs';
const clips = [{ id: '7902c31ae1', text: 'היי, מה קורה?', file: '/greeting.mp4', ready: true }, { id: 'personal', text: 'שלום דני', file: '/personal.mp4', ready: true }];
const play = { action: 'play', clipId: clips[0].id, text: clips[0].text, confidence: 0.96, reason: 'greeting' };
function setup(options = {}) {
  let time = 100000; const output = [], events = [];
  const d = new VideoDirector({ catalog: () => clips, decide: async () => play, providerStatus: () => ({ configured: true }), output: (type, data) => output.push({ type, ...data }), emit: (type, data) => events.push({ type, ...data }), now: () => time, ...options });
  d.setAudienceMode('battle');d.heartbeat({ id: 'stage', ready: true }); d.setMode('auto');
  const advance = n => { time += n; d.heartbeat({ id: 'stage', ready: true }); };
  return { d, output, events, advance };
}
const event = (extra = {}) => {const e={ type: 'opponent', text: 'שלום', uid: 'dan', name: 'דני', ...extra };if(e.type==='chat'||e.type==='opponent')e.text='צינו '+e.text;return e;};
test('only records speech after matching stage ACK; preview/stale ACK cannot finish another clip', async () => {
  const { d, output } = setup(); d.receive(event()); await d.tick(); assert.equal(output.at(-1).type, 'play'); assert.equal(d.counts.played, 0);
  assert.equal(d.playback({ playId: d.active.playId, stageId: 'preview', state: 'started' }).accepted, false);
  d.playback({ playId: d.active.playId, stageId: 'stage', state: 'started', duration: 8 }); assert.equal(d.counts.played, 1);
  d.playback({ playId: 'old', stageId: 'stage', state: 'ended' }); assert.ok(d.active);
  d.playback({ playId: d.active.playId, stageId: 'stage', state: 'ended' }); assert.equal(d.active, null);
});
test('rehearsal chooses but never plays', async () => { const { d, output } = setup(); d.setMode('rehearsal'); d.receive(event()); await d.tick(); assert.equal(d.lastDecision.action, 'play'); assert.equal(output.filter(x => x.type === 'play').length, 0); });
test('missing answer enters operator inbox, never video generation', async () => { const { d, output } = setup({ decide: async () => ({ action: 'draft', clipId: '', text: 'הכל טוב, מה איתך?', confidence: 0.98, reason: 'missing_video' }) }); d.receive(event({ text: 'מה שלומך?' })); await d.tick(); assert.equal(d.saved.inbox[0].videoReady, false); assert.equal(output.length, 0); });
test('invalid recorded text or ID fails closed; uncertainty requires operator review', async () => { for (const bad of [{ ...play, text: 'היי דני מה קורה' }, { ...play, clipId: 'hallucination' }, { ...play, confidence: 0.6 }]) { const { d, output } = setup({ decide: async () => bad }); d.receive(event()); await d.tick(); assert.equal(d.saved.inbox.length, bad.confidence<.88?1:0); assert.equal(d.lastDecision.action,bad.confidence<.88?'draft':'error'); assert.equal(output.length, 0); } });
test('duplicates, flood, links, unknown speaker and stale events filtered before provider call', () => { const { d } = setup(); assert.ok(d.receive(event()).accepted); assert.equal(d.receive(event()).reason, 'duplicate'); assert.equal(d.receive(event({ text: 'https://x.test' })).reason, 'spam'); assert.equal(d.receive(event({ speaker: 'UNKNOWN', text: 'test' })).reason, 'unidentified_speaker'); assert.equal(d.receive(event({ t: 0 })).reason, 'expired_event'); for(let n=0;n<3;n++)d.receive(event({ type:'chat',text:'hello '+n })); assert.equal(d.receive(event({type:'chat',text:'hello again'})).reason,'rate_limited'); });
test('stop cancels an in-flight model response', async () => { let resolve; const { d, output } = setup({ decide: () => new Promise(r => resolve = r) }); d.receive(event()); const p = d.tick(); d.setMode('manual'); resolve(play); await p; assert.equal(output.filter(x=>x.type==='play').length, 0); assert.equal(d.queue.length,0); });
test('new opponent turn invalidates the old answer', async () => { let resolve; const { d, output } = setup({ decide: () => new Promise(r => resolve = r) }); d.receive(event()); const p = d.tick(); d.receive(event({ text: 'רגע אני שואל שאלה אחרת' })); resolve(play); await p; assert.equal(output.filter(x=>x.type==='play').length,0); assert.equal(d.queue.at(-1).text,'רגע אני שואל שאלה אחרת'); });
test('speech, effects and mute hold playback and clear stale queue', async () => { for(const kind of ['otherSpeaking','externalClip','muted']) {const {d,output}=setup();d.receive(event());d.hold(kind,true);await d.tick();assert.equal(output.length,0);assert.equal(d.queue.length,0);d.hold(kind,false);await d.tick();assert.equal(output.length,0);} });
test('opponent is chosen before audience; queue bounded', async () => {const {d}=setup();for(let n=0;n<20;n++)d.receive(event({type:'chat',text:'hi '+n,uid:String(n)}));d.receive(event());assert.equal(d.queue.length,12);await d.tick();assert.equal(d.active.event.type,'opponent');});
test('no audible stage means no automatic selection and expired events do not return', async () => { const {d,advance}=setup();d.stage.ready=false;d.receive(event());await d.tick();assert.equal(d.active,null);advance(21000);await d.tick();assert.equal(d.active,null);assert.equal(d.counts.expired,1); });
test('lost playback confirmation disables auto rather than overlapping next clip', async () => {const {d,advance}=setup();d.receive(event());await d.tick();advance(6500);await d.tick();assert.equal(d.mode,'manual');assert.equal(d.saved.inbox.at(-1).reason,'playback_not_confirmed');});
test('one output owner, lease takeover only after expiry',()=>{const{d,advance}=setup();assert.equal(d.heartbeat({id:'other',ready:true}).owner,false);advance(8000);d.stage.seen-=8000;assert.equal(d.heartbeat({id:'other',ready:true}).owner,true);});
test('approved correction survives restart and cannot leak to another viewer or room', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lion-director-'));try{const file=path.join(dir,'state.json');const {d,advance}=setup({file});d.setRoom('room1');d.setMode('auto');
    const row=d.missing({...event({text:'תזכיר לי מי אני'}),room:'room1',language:'he'}, {text:'',reason:'missing'});
    d.resolve({id:row.id,action:'bind',clipId:'personal',learn:true});assert.equal(d.library().find(x=>x.id==='personal').auto,false);
    const e={...event({text:'תזכיר לי מי אני'}),room:'room1',language:'he'};assert.ok(d.eligible(e).some(x=>x.id==='personal'));assert.ok(!d.eligible({...e,uid:'different'}).some(x=>x.id==='personal'));assert.ok(!d.eligible({...e,room:'room2'}).some(x=>x.id==='personal'));
    let calls=0;const reopened=setup({file,decide:async p=>{calls++;assert.equal(p.examples[0].clipId,'personal');assert.ok(p.candidates.some(c=>c.id==='personal'));return {...play,clipId:'personal',text:'שלום דני'};}}).d;assert.equal(reopened.saved.lessons.length,1);assert.equal((await reopened.choose(e,new AbortController().signal)).clipId,'personal');assert.equal(calls,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('provider absence blocks all automatic answers including greetings, without false video gaps',async()=>{for(const text of ['שלום','מה שלומך?','Hello','איך מזג האוויר?']){const{d,output}=setup({providerStatus:()=>({configured:false})});d.receive(event({text}));await d.tick();assert.equal(output.length,0);assert.equal(d.saved.inbox.length,0);assert.equal(d.lastDecision.reason,'openai_unavailable_operator_required');assert.equal(d.lastDecision.action,'error');}});
test('same clip cannot repeat during cooldown; room switch cancels pending',async()=>{const{d,advance}=setup();d.receive(event());await d.tick();d.playback({stageId:'stage',playId:d.active.playId,state:'started',duration:2});d.playback({stageId:'stage',playId:d.active.playId,state:'ended'});advance(3000);d.receive(event({text:'אהלן'}));await d.tick();assert.equal(d.active,null);assert.equal(d.lastDecision.action,'ignore');assert.equal(d.lastDecision.reason,'existing_answer_cooldown');assert.equal(d.saved.inbox.length,0);d.setRoom('new');assert.equal(d.queue.length,0);});
test('OpenAI transport uses strict Responses schema, no storage, conservative budget; refusal fails closed',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'director-provider-'));try{let captured;const budget=new Budget(path.join(dir,'budget.json'),5);const p=new VideoDecisionProvider({budget,audioDir:dir,originalVoice:{status:()=>({})},fetchImpl:async(url,opts)=>{captured={url,...JSON.parse(opts.body)};return{ok:true,json:async()=>({status:'completed',usage:{input_tokens:25,output_tokens:20},output:[{content:[{type:'output_text',text:JSON.stringify(play)}]}]})};}});p.setKey(('sk-proj-'+'test'.repeat(20)));assert.equal((await p.decideVideo({event:event()},new AbortController().signal)).clipId,play.clipId);assert.equal(captured.store,false);assert.equal(captured.text.format.strict,true);assert.equal(budget.status().requests,1);p.fetchImpl=async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'refusal',refusal:'no'}]}]})});await assert.rejects(()=>p.decideVideo({}),/decision_unavailable/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('a live opponent turn interrupts an audience clip and receives the next turn',async()=>{const {d,output}=setup();d.receive(event({type:'chat'}));await d.tick();assert.equal(d.active.event.type,'chat');d.receive(event({text:'אהלן'}));assert.equal(d.active,null);assert.equal(output.at(-1).reason,'opponent_takes_turn');assert.equal(d.queue[0].type,'opponent');});
test('neutral greeting recordings are never answers to a how-are-you question even if model recommends them',async()=>{const {d,output}=setup();d.receive(event({text:'מה שלומך היום?'}));await d.tick();assert.equal(output.length,0);assert.equal(d.lastDecision.reason,'decision_question_not_answer');assert.equal(d.saved.inbox.length,0);});
test('viewer name persists beyond recent dialogue and remains isolated by room and stable ID',()=>{const {d,advance}=setup();d.setRoom('room-a');d.receive(event({type:'chat',uid:'same',name:'דני'}));advance(61000);d.receive(event({type:'chat',uid:'same',name:'',text:'חזרתי שוב'}));assert.equal(d.saved.history.at(-1).name,'דני');d.receive(event({type:'chat',uid:'someone-else',name:'',text:'מי אני'}));assert.equal(d.saved.history.at(-1).name,'');d.setRoom('room-b');d.receive(event({type:'chat',uid:'same',name:'',text:'חזרתי שוב'}));assert.equal(d.saved.history.at(-1).name,'');});
test('solo host can keep engaging a live room during quiet gaps without needing a new chat event',async()=>{let called=0;const {d,advance}=setup({context:()=>({videoMode:true,audienceConnection:{on:true,lastEventAt:100000}}),decide:async p=>{called++;assert.equal(p.event.type,'audience');return{action:'ignore',text:'',clipId:'',confidence:1,reason:'wait'};}});d.setAudienceMode('solo');advance(18001);await d.tick();assert.equal(called,1);advance(1000);await d.tick();assert.equal(called,1);advance(130000);await d.tick();assert.equal(called,2);});

test('chat requires the name at the beginning on EVERY turn, accepting Hebrew apostrophe variants',()=>{
 const {d}=setup();
 for(const [i,text] of ['צינו שלום','צ\'ינו שלום','צ׳ינו שלום','צ’ינו שלום','Chino hello'].entries()){
  const r=d.receive({type:'chat',text,uid:'viewer-'+i});assert.equal(r.accepted,true,text);
 }
 for(const text of ['מה נשמע','היי צינו','ראיתי את צינו','צינור שלום','צינולוגיה'])assert.equal(d.receive({type:'chat',text,uid:'viewer-0'}).reason,'chat_name_required');
 assert.equal(d.queue[0].text,'שלום');assert.equal(d.dialogue,null);
});
test('ordinary opponent speech never calls the provider before the name is heard',async()=>{
 let called=0;const {d}=setup({decide:async()=>{called++;return play;}});
 assert.equal(d.receive({type:'opponent',text:'חברים תעשו לייקים',uid:'op'}).reason,'waiting_for_name');
 await d.tick();assert.equal(called,0);assert.equal(d.dialogueStatus().light,'red');
 assert.equal(d.receive({type:'opponent',text:'תגיד צ׳ינו מה שלומך',uid:'op'}).accepted,true);
 assert.equal(d.dialogueStatus().light,'green');
});
test('calling only Chino or chiino gets a GPT-reviewed real clip, including after timeout',async()=>{
 let calls=0;const {d,advance}=setup({decide:async()=>{calls++;return play;}});
 for(const text of ['chiino','צינו','צ׳ינו']){
  assert.equal(d.receive({type:'opponent',text,uid:'dan'}).accepted,true);await d.tick();assert.ok(d.active);assert.equal(d.active.clipId,'7902c31ae1');finishReply(d);advance(16000);
 }
 assert.equal(calls,3);
});
function finishReply(d){const playId=d.active.playId;d.playback({playId,stageId:'stage',state:'started',duration:8});d.playback({playId,stageId:'stage',state:'ended'});}
test('120-second follow-up window starts at actual playback END, expires red, and needs the name again',async()=>{
 const {d,advance}=setup();d.receive(event());await d.tick();
 d.playback({playId:d.active.playId,stageId:'stage',state:'started',duration:30});advance(18000);
 assert.equal(d.dialogueStatus().state,'speaking');
 d.playback({playId:d.active.playId,stageId:'stage',state:'ended'});
 assert.equal(d.dialogueStatus().secondsLeft,120);advance(119999);assert.equal(d.dialogueStatus().light,'green');
 advance(1);assert.equal(d.dialogueStatus().light,'red');
 assert.equal(d.receive({type:'opponent',text:'איך הולך',uid:'dan'}).reason,'waiting_for_name');
 assert.equal(d.receive(event({text:'חזרתי'})).accepted,true);
});
test('follow-up belongs only to the same opponent and room',async()=>{
 const {d}=setup();d.receive(event());await d.tick();finishReply(d);
 assert.equal(d.receive({type:'opponent',uid:'someone-else',text:'ומה איתי'}).accepted,false);
 assert.equal(d.receive({type:'opponent',uid:'dan',text:'גם אצלי טוב'}).accepted,true);
 assert.equal(d.queue[0].addressedBy,'conversation_followup');
 d.setRoom('another-room');assert.equal(d.receive({type:'opponent',uid:'dan',text:'ומה עכשיו'}).accepted,false);
});
test('microphone practice uses two full minutes like the live conversation',async()=>{
 const {d,advance}=setup();d.receive(event({source:'microphone'}));await d.tick();finishReply(d);advance(119000);
 assert.equal(d.dialogueStatus().active,true);assert.equal(d.dialogueStatus().practice,true);assert.equal(d.dialogueStatus().secondsLeft,1);
 assert.equal(d.receive({type:'opponent',uid:'dan',source:'microphone',text:'עוד שאלה'}).accepted,true);
 d.endDialogue();assert.equal(d.dialogueStatus().active,false);
});
test('starting to answer during the window preserves the conversation through speech and transcription',async()=>{
 const {d,advance}=setup();d.receive(event());await d.tick();finishReply(d);advance(14000);
 d.hold('otherSpeaking',true);advance(120000);assert.equal(d.dialogueStatus().state,'listening');
 d.hold('otherSpeaking',false);advance(5000);assert.equal(d.dialogueStatus().state,'transcribing');
 assert.equal(d.receive({type:'opponent',uid:'dan',text:'גם אני בסדר תודה'}).accepted,true);
});
test('chat gets a turn after an eight-second quiet gap while opponent recognition stays open',async()=>{
 const calls=[];const {d,advance}=setup({decide:async p=>{calls.push(p.event.type);return p.event.type==='opponent'?play:{action:'draft',text:'כיף שבאת',clipId:'',confidence:1,reason:'missing'};}});
 d.receive(event());await d.tick();finishReply(d);
 d.receive(event({type:'chat',uid:'viewer-a',text:'מה שלומך'}));advance(5000);await d.tick();assert.deepEqual(calls,['opponent']);
 advance(3000);await d.tick();assert.deepEqual(calls,['opponent','chat','chat']);assert.equal(d.queue.length,0);assert.equal(d.dialogueStatus().active,true);assert.equal(d.dialogueStatus().uid,'dan');
});
test('isolated speech interrupts a playing audience response without discarding waiting viewers',async()=>{
 const {d,output}=setup();d.receive(event({type:'chat',uid:'a'}));await d.tick();d.receive(event({type:'chat',uid:'b',text:'היי'}));
 d.hold('otherSpeaking',true);assert.equal(d.active,null);assert.equal(output.at(-1).reason,'otherSpeaking');assert.equal(d.queue[0].uid,'b');
});
test('one pending message per viewer preserves their position while other viewers also queue',()=>{
 const {d,advance}=setup();d.receive(event({type:'chat',uid:'a',text:'שאלה ראשונה'}));advance(1000);d.receive(event({type:'chat',uid:'b',text:'שאלה שנייה'}));advance(1000);d.receive(event({type:'chat',uid:'a',text:'תיקון לשאלה שלי'}));
 assert.deepEqual(d.queue.map(x=>x.uid),['a','b']);assert.equal(d.queue[0].text,'תיקון לשאלה שלי');
});
test('assistant editorial review preserves the original, never approves text or invents video',()=>{
 const {d}=setup();const row=d.missing({...event(),room:'',language:'he'},{text:'original',reason:'practice'});row.practice={action:'answer'};
 d.resolve({id:row.id,action:'review_draft',draft:'נוסח משופר',responseAction:'answer'});
 assert.equal(row.originalDraft,'original');assert.equal(row.assistantReviewed,true);assert.equal(row.operatorApprovedText,false);assert.equal(row.videoReady,false);
 d.resolve({id:row.id,action:'draft',draft:'הנוסח שלי'});assert.equal(row.operatorApprovedText,true);assert.equal(row.videoReady,false);
});
test('listening practice can have no spoken text and is never approved for speech',()=>{
 const {d}=setup();const row=d.missing({...event(),room:'',language:'he'},{text:'original',reason:'practice'});row.practice={action:'answer'};
 d.resolve({id:row.id,action:'review_draft',draft:'',responseAction:'listen'});assert.equal(row.draft,'');assert.equal(row.practice.action,'listen');assert.equal(row.operatorApprovedText,false);
});
test('speech transcription reuses the budget and credential transport with multipart and bilingual name hints',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chino-asr-'));
 try{let captured;const budget=new Budget(path.join(dir,'budget.json'),5);
  const p=new VideoDecisionProvider({budget,audioDir:dir,originalVoice:{status:()=>({})},fetchImpl:async(url,opts)=>{captured={url,...opts};return {ok:true,json:async()=>({text:'צ׳ינו',languages:[{code:'he'}]})};}});
  p.setKey(('sk-proj-'+'test'.repeat(20)));assert.equal(await p.transcribeAudio(Buffer.from('test audio').toString('base64')),'צ׳ינו');
  assert.ok(captured.url.endsWith('/audio/transcriptions'));assert.ok(captured.body instanceof FormData);assert.equal(captured.headers['Content-Type'],undefined);
  assert.equal(captured.body.get('model'),'gpt-transcribe');assert.deepEqual(captured.body.getAll('languages[]'),['he','en']);assert.equal(captured.body.get('file').type,'audio/webm');assert.equal(budget.status().requests,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('voice follow-up after 100 seconds needs no repeated wake name and the next reply renews two minutes',async()=>{
 const {d,advance}=setup();d.receive(event());await d.tick();finishReply(d);advance(100000);
 assert.equal(d.receive({type:'opponent',uid:'dan',text:'אהלן'}).accepted,true);await d.tick();assert.ok(d.active);finishReply(d);assert.equal(d.dialogueStatus().secondsLeft,120);
});
test('a listening/ignore decision does not eject the speaker from an active conversation',async()=>{
 const {d,advance}=setup({decide:async()=>({action:'ignore',clipId:'',text:'',confidence:1,reusable:false,reason:'listen'})});d.receive(event({text:'רגע אני חושב'}));await d.tick();advance(100000);
 assert.equal(d.receive({type:'opponent',uid:'dan',text:'עכשיו יש לי שאלה'}).accepted,true);
});


test('chat focus opens only after real output ACK and same viewer follows up for two minutes',()=>{
 const {d,advance}=setup();const e={type:'chat',uid:'viewer-focus',name:'מרים',text:'שלום',room:d.room,id:'focus-event',source:'tiktools'};
 assert.equal(d.receive({...e,id:'before',text:'מה איתך'}).accepted,false);
 d.play(clips[0],e);const playId=d.active.playId;
 assert.equal(d.playback({stageId:'preview',playId,state:'started',duration:2}).accepted,false);
 assert.equal(d.receive({...e,id:'still-before',text:'תודה רבה'}).accepted,false);
 d.playback({stageId:'stage',playId,state:'started',duration:2});d.playback({stageId:'stage',playId,state:'ended'});
 assert.equal(d.status().conversation.channel,'chat');assert.equal(d.receive({...e,id:'followup',text:'תודה רבה'}).accepted,true);
 assert.equal(d.lastRouting.reason,'chat_conversation_followup');assert.equal(d.receive({...e,uid:'another-viewer',id:'other',text:'גם אני'}).accepted,false);
 advance(120001);assert.equal(d.receive({...e,id:'expired',text:'מה קורה עכשיו'}).accepted,false);
 assert.equal(d.receive({...e,id:'wake-again',text:'צינו מה קורה עכשיו'}).accepted,true);
});

test('solo chat needs no wake word; switching to battle restores addressing rules',()=>{
 const {d}=setup();d.setAudienceMode('solo');assert.equal(d.receive({type:'chat',uid:'viewer-solo',text:'מה נשמע חבר?',id:'solo-one'}).accepted,true);assert.equal(d.lastRouting.reason,'solo_chat');
 d.setAudienceMode('battle');assert.equal(d.receive({type:'chat',uid:'viewer-solo',text:'מה נשמע עכשיו?',id:'battle-one'}).accepted,false);
 assert.equal(d.receive({type:'chat',uid:'viewer-solo',text:'צינו מה נשמע עכשיו?',id:'battle-two'}).accepted,true);
});

test('host initiates bilingual opponent conversation, waits for turn and pivots after two unanswered attempts',async()=>{
 const turns=[];const {d,advance}=setup({context:()=>({videoMode:true,opponent:{handle:'guest',language:'en'},audienceConnection:{on:true}}),decide:async p=>{turns.push(p.event);return {action:'ignore',text:'',clipId:'',confidence:1,reason:'listen'};}});
 advance(18001);await d.tick();assert.equal(turns.length,1);assert.equal(turns[0].type,'opponent');assert.equal(turns[0].language,'en');assert.equal(turns[0].hostInitiated,true);
 d.hold('otherSpeaking',true);advance(19000);await d.tick();assert.equal(turns.length,1);d.hold('otherSpeaking',false);d.dialogue.state='waiting';advance(8000);await d.tick();assert.equal(turns.length,2);
 advance(18001);await d.tick();assert.equal(turns.length,3);assert.equal(turns[2].type,'audience');
});


test('missing opponent video does not freeze waiting chat for the recognition window',async()=>{
 const calls=[];const {d,advance}=setup({decide:async p=>{calls.push(p.event.type);return p.event.type==='opponent'?{action:'draft',text:'צריך לברר את זה',clipId:'',confidence:1,reason:'missing'}:play;}});
 d.receive(event());await d.tick();assert.equal(d.dialogueStatus().state,'needs_video');
 d.receive(event({type:'chat',uid:'viewer',text:'צינו שלום'}));advance(7999);await d.tick();assert.deepEqual(calls,['opponent','opponent']);
 advance(1);await d.tick();assert.ok(d.active);assert.equal(d.active.event.type,'chat');assert.equal(d.dialogueStatus().uid,'dan');
 d.receive(event({text:'צינו חזרתי'}));assert.equal(d.active,null);assert.equal(d.queue[0].type,'opponent');
});

test('host pivots to audience while missing opponent media is pending, without claiming an answer',async()=>{
 const turns=[];const {d,advance}=setup({context:()=>({videoMode:true,opponent:{handle:'dan'},audienceConnection:{on:true}}),decide:async p=>{turns.push(p.event);return {action:'draft',text:'עוד רגע נברר',clipId:'',confidence:1,reason:'missing'};}});
 d.receive(event());await d.tick();assert.equal(d.dialogueStatus().state,'needs_video');
 advance(18001);await d.tick();assert.equal(turns.at(-1).type,'audience');assert.equal(turns.at(-1).hostInitiated,true);assert.equal(d.dialogueStatus().uid,'dan');
});

test('waiting viewers cannot interrupt opponent speech or transcription after a long gap',async()=>{
 const {d,advance}=setup();d.receive(event());await d.tick();finishReply(d);d.receive(event({type:'chat',uid:'viewer',text:'צינו שלום'}));
 d.hold('otherSpeaking',true);advance(30000);await d.tick();assert.equal(d.active,null);assert.equal(d.queue.length,1);
 d.hold('otherSpeaking',false);advance(30000);await d.tick();assert.equal(d.dialogueStatus().state,'transcribing');assert.equal(d.active,null);
});
