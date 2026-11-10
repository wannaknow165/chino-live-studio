// ARIEL LIVE — local server (Node 18+, no dependencies)
// Video bank: search first, generate only if missing (Gemini Omni). Songs: learn + dance.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { LearningStore, analyzeBatch, transcriptRows, classifyProviderFailure, SITUATIONS } from './learning-store.mjs';
import { LocalTranscriber } from './local-transcriber.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
process.on('unhandledRejection', e => console.log('[unhandled]', e && e.message || e));
process.on('uncaughtException', e => console.log('[uncaught]', e && e.message || e));
const PORT = Number(process.env.ARIEL_PORT || 7777);
const BOOT = +process.env.ARIEL_BOOT || Date.now();   // pages compare this on reconnect and reload themselves after a server restart (ARIEL_BOOT = restart during a live WITHOUT reloading the stage)
const P = (...a) => path.join(ROOT, ...a);
for (const d of ['media/idle', 'media/bank', 'media/songs', 'media/dance', 'media/rejected', 'media/fun', 'media/overlays', 'data']) fs.mkdirSync(P(d), { recursive: true });

// ---------- key ----------
function readKey() {
  for (const f of [P('.env'), P('..', '.env')]) {
    try { const m = fs.readFileSync(f, 'utf8').match(/^GEMINI_API_KEY=(\S+)/m); if (m) return m[1]; } catch {}
  }
  return process.env.GEMINI_API_KEY || '';
}
const KEY = readKey();
const OMNI = 'gemini-omni-1.2-flash';
const BRAIN = 'gemini-3.8-flash';

// ---------- db ----------
const loadJ = (f, d) => { try { return JSON.parse(fs.readFileSync(P('data', f), 'utf8')); } catch { return d; } };
const saveJ = (f, o) => fs.writeFileSync(P('data', f), JSON.stringify(o, null, 2));
const evidence = new LearningStore(P('data','learning'));
const asrConfig = loadJ('local-transcription-config.json',{});
const localASR = asrConfig.model ? new LocalTranscriber(P('.venv-learning','Scripts','python.exe'),[P('tools','transcribe_local.py'),asrConfig.model]) : null;
const providerState = loadJ('provider_state.json',{blocked:'',until:0});
function assertProviderReady() {
  if(providerState.blocked==='billing' || providerState.until>Date.now())throw new Error('Gemini billing/quota paused');
}
let bank = loadJ('bank.json', []);      // [{id,text,norm,file,count,created,last}]
let songs = loadJ('songs.json', []).filter(x => !/\?\?\?/.test(x.name || ''));    // [{id,name,file,analysis,dances:[file],created}]
const norm = s => (s || '').replace(/[֑-ׇ]/g, '').replace(/[׳'"״`.,!?;:\-–—()…]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

// ---------- events (SSE) to stage + control ----------
let headFrame = null, headTs = 0, headState = { on: false, fx: 'bubble' };
let capsOn = loadJ('caps.json', { on: true }).on !== false;
let labelState = { ...{ on: true, text: 'test', color: '#ff2d2d' }, ...loadJ('label.json', {}) };
const clients = new Set(); const stageLog = [];
function emit(type, data) { if (type === 'play') lastLionSpokeAt = Date.now(); const msg = `data: ${JSON.stringify({ type, ...data })}\n\n`; for (const c of clients) c.write(msg); }

// ---------- Gemini ----------
const master64 = () => fs.readFileSync(P('media', 'master.png')).toString('base64');
function findVideo(o) {
  if (!o || typeof o !== 'object') return null;
  if (Array.isArray(o)) { for (const v of o) { const x = findVideo(v); if (x) return x; } return null; }
  if (o.type === 'video' && o.data) return o.data;
  for (const v of Object.values(o)) { const x = findVideo(v); if (x) return x; }
  return null;
}
async function omni(prompt, outFile, res = '720p', first = null) {
  if(training.observeOnly)throw new Error('Observation mode: video generation disabled');
  assertProviderReady();
  const img = master64();
  const body = {
    model: OMNI,
    input: first ? [ { type: 'image', data: first.data, mime_type: first.mime }, { type: 'text', text: prompt } ] : [
      { type: 'image', data: img, mime_type: 'image/png' },
      { type: 'image', data: img, mime_type: 'image/png' },
      { type: 'text', text: prompt },
    ],
    generation_config: { video_config: { task: 'image_to_video' } },
    response_format: { type: 'video', aspect_ratio: '9:16', resolution: res },
  };
  const t = Date.now();
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST', headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(300000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || ('HTTP ' + r.status));
  const v = findVideo(j);
  if (!v) throw new Error('Gemini returned no video');
  fs.writeFileSync(outFile, Buffer.from(v, 'base64'));
  return Math.round((Date.now() - t) / 1000);
}
async function brain(parts, json = true) {
  assertProviderReady();
  if(training.observeOnly && parts.some(x=>x.inline_data))throw new Error('Cloud media analysis disabled in observation mode');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${BRAIN}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: json ? { responseMimeType: 'application/json' } : {} }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || ('HTTP ' + r.status));
  const txt = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  return json ? JSON.parse(txt) : txt;
}


// ---------- quality check (Gemini watches the clip) ----------
const QC_MIN = 6;
async function review(file, expected) {
  const extra = expected ? `Expected spoken Hebrew text: "${expected}". words_ok = the speech matches it closely.` : 'This clip must be SILENT (no speech); words_ok = true only if nobody speaks.';
  const q = `You are a strict quality inspector for a livestream. Watch this 10s video of a crowned lion king on a throne; he must look the same through the whole video.
Find defects: morphing/warping of face or body, double-exposure / ghosting (one video blended over another), face or crown changing identity, distorted or asymmetric eyes, flicker, sudden jumps or cuts, broken paws, text on screen.
${extra}
Also judge identity: is it the SAME lion (same face shape, eyes, nose, mane colour and volume, same crown and chains) in every frame from start to end, with no morphing into a different-looking lion? identity_stable = true only if yes.
Return JSON only: {"score": 1-10 (10 = flawless, broadcast-ready), "identity_stable": true/false, "defects": [short strings], "transcript": "exact words spoken or empty", "words_ok": true/false}`;
  try {
    return await brain([{ inline_data: { mime_type: 'video/mp4', data: fs.readFileSync(file).toString('base64') } }, { text: q }]);
  } catch (e) { return { score: QC_MIN, defects: ['qc failed: ' + e.message], words_ok: true }; }
}
// generate up to 3 times, keep the first that passes, else the best one
async function generateChecked(prompt, target, expected, res = '720p', label = '') {
  let best = null; const t0 = Date.now();
  for (let k = 1; k <= 3; k++) {
    const tmp = P('media', 'rejected', path.basename(target).replace(/\.mp4$/, `_try${k}.mp4`));   // work files never sit in a live folder
    await runJob(() => omni(prompt, tmp, res));
    const r = await review(tmp, expected);
    const pass = r.words_ok !== false && r.identity_stable !== false && (r.score || 0) >= QC_MIN;
    emit('status', { msg: `${label} ניסיון ${k}: ציון ${r.score}/10${pass ? ' ✓' : ' ✗ ' + (r.defects || []).join(', ')}` });
    if (!best || (r.words_ok !== false) > (best.r.words_ok !== false) || ((r.words_ok !== false) === (best.r.words_ok !== false) && r.score > best.r.score)) {
      best = { tmp, r };
    }
    if (pass) break;
  }
  fs.renameSync(best.tmp, target);
  return { secs: Math.round((Date.now() - t0) / 1000), score: best.r.score, defects: best.r.defects || [] };
}


// ---------- persona: turn the operator's line into the lion's own line ----------
const DEFAULT_PERSONA = `You are CHINO (צ׳ינו), the lion king of a Hebrew TikTok live: a crowned lion on a golden throne. Your name is Chino. You are from Tel Aviv, a rich man with a lot of money, you fly around the world constantly, and you are crazy about girls (flirty and charming, never vulgar). A charismatic mafia-boss king: cynical, funny, confident, warm to your fans. You speak natural Israeli street Hebrew (slang is welcome: אחי, יאללה, וואלה, סבבה, כפרה), short and punchy, never formal, never robotic. When someone asks who you are, introduce yourself fast and proud: "אני צ׳ינו, המלך מתל אביב".`;
let persona = loadJ('persona.json', { text: DEFAULT_PERSONA });
if (/^You are ARIEL,/.test(persona.text)) { persona = { text: DEFAULT_PERSONA }; saveJ('persona.json', persona); }
async function toLion(input) {
  const r = await brain([{ text: `${persona.text}
The live operator gives you a line for ARIEL to say to the chat. Change AS LITTLE AS POSSIBLE: keep the operator's words, order and meaning; only fix broken Hebrew and add at most a small touch of ARIEL's tone (one slang word at most). If the input is an instruction ("תגיד לו תודה"), turn it into the direct first-person line.
NEVER change, translate or drop names of people or nicknames — copy them letter by letter. KEEP THE INPUT'S LANGUAGE (Hebrew stays Hebrew, English stays English). Max 14 words, no emojis.
Operator input: "${input}"
Return JSON: {"line": "what Ariel says", "names": ["every person name or nickname from the input, verbatim"], "emotion": "one English word", "face": "short English description of facial expression and small head movement"}` }]);
  return { line: String(r.line || input).trim(), names: Array.isArray(r.names) ? r.names : [], emotion: r.emotion || 'confident', face: r.face || '' };
}

// ---------- prompts ----------
const LOOK = 'The exact same lion king seated on the golden throne, locked-off static camera, same crown, same gold chains, same room and lighting as the image. His face stays identical to the image: both amber eyes sharp, clear, symmetrical and natural, no eye distortion, no warping of the face.';
const VOICE = 'His voice is always the same: an ultra-deep, gravelly, menacing male bass with vocal fry and a native Israeli accent, slow and confident like a mafia-boss king, with a cynical smirk.';
const talkPrompt = (text, d = {}) => `${LOOK} He speaks directly to the camera in the language of the line (Hebrew or English; if English, a confident Israeli-accented English). ${VOICE} Emotion: ${d.emotion || 'confident'}. ${d.face ? 'Expression: ' + d.face + '.' : ''} His mouth clearly articulates every syllable in perfect sync with the words, expressive eyes and brows, only very small head movements. He stays exactly the same lion in every frame: identical face, eyes, nose, mane colour and volume, crown and chains — no morphing, no change of identity. ${d.move ? d.move + ' Gestures stay clean and readable, paws never warp.' : 'Both paws stay resting on the golden armrests the whole time with only tiny natural movements, no big hand gestures.'} At the end he returns to the exact starting pose. He says exactly, nothing more and nothing less: "${text}". Audio: ONLY his dry voice — no music, no background sounds, no ambience, no sound effects. No subtitles, no on-screen text, no cuts. The video starts and ends on the same pose as the image.`;
const idlePrompt = extra => `${LOOK} Idle, he is waiting and alive: calm slow breathing in the chest, natural blinks, ${extra || 'a small head turn and settle back, mane gently moving, slight paw movement on the armrest'}. Mouth stays closed, he does not speak. The video starts and ends on the exact same pose as the image. No camera motion, no zoom, no cuts, no text. Silent, no music, no dialogue.`;
const dancePrompt = (a, i) => `${LOOK} He dances to ${a.genre || 'music'} at about ${a.bpm || 100} BPM while staying seated on the throne: ${a.dance || 'head bobbing on the beat, shoulders swaying, paws hitting the armrests to the rhythm'}. Mood: ${a.mood || 'confident, fun'}. Variation ${i + 1}: ${['bigger head bobs and shoulder bounce', 'paws up, hype gestures toward the camera', 'smooth groove, cool king attitude, a nod and a smirk'][i % 3]}. Keep the paws simple and clean, no warping. Mouth closed, no singing. Starts and ends on the exact same pose as the image. No camera motion, no cuts, no text. Silent.`;

// ---------- job queue (max 3 parallel generations) ----------
const jobs = new Map(); let running = 0; const waiting = [];
function runJob(fn) { return new Promise((res, rej) => { waiting.push({ fn, res, rej }); pump(); }); }
function pump() { while (running < 3 && waiting.length) { const { fn, res, rej } = waiting.shift(); running++; fn().then(res, rej).finally(() => { running--; pump(); }); } }


// keep only the lion's voice (the video engine bakes music/noise into its audio)
function cleanVoice(file) {
  return new Promise(res => execFile('py', ['-3.13', P('tools', 'clean_voice.py'), file], { windowsHide: true, timeout: 180000 }, err => { if (err) console.log('[clean]', err.message); res(!err); }));
}
let cleaningAll = false;
async function cleanAll() {
  if (cleaningAll) return; cleaningAll = true;
  const list = bank.filter(b => !b.clean);
  emit('status', { msg: `🧼 מנקה את הקול ב-${list.length} משפטים…` });
  let n = 0;
  for (const b of list) { if (await cleanVoice(P('media', 'bank', b.file))) { b.clean = true; n++; saveJ('bank.json', bank); } }
  cleaningAll = false; emit('status', { msg: `🧼 הקול נוקה ב-${n} משפטים ✓` });
}


// ---------- conversation: the lion hears the opponent and answers ----------
let convo = loadJ('convo.json', []);       // [{t, who:'opponent'|'ariel', text}]
let convoSettings = { ...{ autoReply: false, replyEveryMs: 20000 }, ...loadJ('convo_settings.json', {}) };
let lastReplyAt = 0;
function pushConvo(who, text) { convo.push({ t: Date.now(), who, text }); if (convo.length > 400) convo.shift(); saveJ('convo.json', convo); emit('convo', { who, text }); }
async function replyToOpponent(heard) {
  const recent = convo.slice(-14).map(x => (x.who === 'ariel' ? 'CHINO' : x.who === 'opponent' ? 'OPPONENT' : 'CHAT') + ': ' + x.text).join('\n');
  const known = bank.slice().sort((a, b) => b.count - a.count).slice(0, 60).map(b => b.text);
  const r = await brain([{ text: `${persona.text}
${knowledgeDigest()}${lessonsDigest()}${namesDigest()}
You are CHINO in a live TikTok BATTLE, having a real spoken conversation with the OPPONENT (the other streamer). He just spoke. Answer him like a real person talking back: natural, quick, flowing.
- If he greets/asks how you are: answer AND ask him back ("הכל טוב אחי, מה איתך?").
- If he laughs or says something short: react short (a laugh, a jab, a comeback) — don't give a speech.
- If he asks about you: answer with your identity (Chino, Tel Aviv, money, travel, girls), proud and funny.
- If he teases: tease back, confident, never cruel. Never sexual, no insults about looks/race/religion, no threats.
- LANGUAGE: answer in the language you were spoken to — Hebrew to Hebrew, English to English (natural, casual, native-sounding). If you lack a good Hebrew line, English is fine. Never mix clumsily. Max 12 words, first person. Copy any names EXACTLY.
- STRONGLY prefer a READY line when it fits the moment (copy it EXACTLY) — it plays instantly. Otherwise write a new one.
Conversation so far:
${recent}
OPPONENT (his name is "${opp.name || 'unknown'}" — use it when natural) just said: "${heard}"
READY lines: ${JSON.stringify(known)}
Return JSON: {"line": "CHINO's reply", "reused": true/false, "emotion": "one English word", "face": "short English description of expression"}` }]);
  return { line: String(r.line || '').trim(), reused: !!r.reused, emotion: r.emotion || 'confident', face: r.face || '' };
}
async function onHeard(text) {
  text = String(text || '').trim(); if (text.length < 2) return;
  pushConvo('opponent', text);
  emit('heard', { text });
  if (!convoSettings.autoReply) return;
  // real conversation: answer every time the opponent speaks (he is talking TO us), but one reply at a time.
  // only a tiny gap so Chino doesn't talk over himself; the brain decides if a short reaction or a real answer fits.
  if (opponentBusy) { opponentPending = text; return; }
  opponentBusy = true;
  try {
    const d = await replyToOpponent(text);
    if (d.line) {
      pushConvo('ariel', d.line);
      if (!bankHit(d.line, true)) { emit('status', { msg: `🧠 עונה ליריב: "${d.line}"` }); await generateLine(d.line, d, { play: true }); }
    }
  } catch (e) { emit('status', { msg: 'תגובה נכשלה: ' + e.message }); }
  lastReplyAt = Date.now(); opponentBusy = false;
  if (opponentPending) { const t = opponentPending; opponentPending = null; setTimeout(() => onHeard(t), 400); }
}
let opponentBusy = false, opponentPending = null;


// ---------- quick answers: lines CHINO must have ready for instant replies ----------
const QUICK_LINES = [
  'מה קורה {שם}? מוכן להפסיד למלך?',
  '{שם} אחי, כבוד לראות אותך',
  'תקשיב {שם}, אני צ׳ינו מתל אביב. תזכור',
  '{שם}, הצ׳אט שלי יאכל אותך',
  'חחח {שם}, אתה מצחיק אותי',
  '{שם} כפרה, תרים לייקים',
  'אני צ׳ינו, המלך מתל אביב, נעים מאוד',
  'מה קורה אחי? הכל טוב, אני על הכס',
  'סבבה לגמרי כפרה, מה איתך?',
  'קוראים לי צ׳ינו. תזכור את השם',
  'מתל אביב, אחי, איפה עוד?',
  'כסף? יש, ברוך השם. וטסתי מחר שוב',
  'וואלה את יפה, בואי תשבי לידי על הכס',
  'יאללה, תשאל מה שבא לך',
  'מה שלומי? מלך. תמיד מלך',
  'חחח אחי אתה מצחיק אותי',
  'לא שמעתי, תגיד שוב בצ׳אט',
  'רגע רגע, אחד אחד, אני מלך לא מכונה',
  'הכל טוב אחי, מה איתך?',
  'חחחח וואלה הצחקת אותי',
  'יאללה יאללה, תמשיך לדבר',
  'אתה רציני? חחח אחי',
  'מה אתה אומר! ספר עוד',
  'אחי אתה מלך, בכבוד',
  'טוב טוב, נראה אותך',
  'אני מקשיב, דבר',
  'כפרה עליך, מה הקטע?',
  'אוקיי אחי, הבנתי אותך',
  'לא לא לא, תן לי לדבר',
];
async function warmQuick() { let n = 0; for (const l of QUICK_LINES) { if (!bankHit(l, false)) { n++; generateLine(l, { line: l }, { play: false }).catch(e => emit('status', { msg: 'שגיאה: ' + e.message })); } } return n; }


// ---------- TikTok LIVE chat via tik.tools (WebSocket) ----------
let tt = { ws: null, on: false, user: '', status: 'כבוי', seen: 0, lastEvt: {} };
let viewers = loadJ('viewers.json', {});          // uniqueId -> {name, firstSeen, msgs, gifts, diamonds, lastSeen}
function viewer(u) { if (!u || !u.uniqueId) return null; const id = u.uniqueId; const v = viewers[id] || (viewers[id] = { name: u.nickname || id, firstSeen: Date.now(), msgs: 0, gifts: 0, diamonds: 0 }); v.name = u.nickname || v.name; v.lastSeen = Date.now(); const pic = u.profilePictureUrl || u.profilePicture?.urls?.[0] || u.profilePicture?.url?.[0] || u.avatarThumb?.urlList?.[0] || u.avatarThumb?.url_list?.[0] || u.avatar_thumb?.url_list?.[0] || u.avatar?.url_list?.[0] || ''; if (typeof pic === 'string' && pic.startsWith('http')) v.pic = pic; return v; }
function saveViewers() { saveJ('viewers.json', viewers); }
async function ttJwt() {
  const r = await fetch('https://api.tik.tools/authentication/jwt?apiKey=' + encodeURIComponent(settings.tiktoolsKey), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_creators: [tt.user], expire_after: 3600, max_websockets: 1 }) });
  const j = await r.json(); if (!r.ok || !j?.data?.token) throw new Error(j?.message || j?.error || 'jwt failed'); return j.data.token;
}
function ttEmit() { emit('tiktok', { on: tt.on, user: tt.user, status: tt.status, seen: tt.seen }); }
async function ttConnect(user) {
  tt.user = String(user || settings.tiktokUser || '').replace(/^@/, '').trim(); if (!tt.user) throw new Error('חסר שם משתמש טיקטוק');
  if (!settings.tiktoolsKey) throw new Error('חסר מפתח tik.tools');
  settings.tiktokUser = tt.user; saveJ('settings.json', settings);
  ttDisconnect(false); tt.on = true; tt.status = 'מתחבר…'; ttEmit();
  let url;
  try { const tok = await ttJwt(); url = `wss://api.tik.tools?uniqueId=${encodeURIComponent(tt.user)}&jwtKey=${encodeURIComponent(tok)}`; }
  catch (e) { url = `wss://api.tik.tools?uniqueId=${encodeURIComponent(tt.user)}&apiKey=${encodeURIComponent(settings.tiktoolsKey)}`; }
  const ws = new WebSocket(url); tt.ws = ws;
  ws.onopen = () => { tt.status = 'מחובר — מחכה לאירועים'; ttEmit(); };
  ws.onmessage = ev => { try { onTikTok(JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())); } catch (e) { console.log('[tt parse]', e.message); } };
  ws.onerror = e => { tt.status = 'שגיאת חיבור'; ttEmit(); };
  ws.onclose = ev => { tt.ws = null; tt.status = 'נותק (' + (ev.code || '') + ') ' + (ev.reason || ''); ttEmit(); if (tt.on) setTimeout(() => { if (tt.on) ttConnect(tt.user).catch(() => {}); }, 5000); };
}
function ttDisconnect(final = true) { if (final) tt.on = false; if (tt.ws) { try { tt.ws.onclose = null; tt.ws.close(); } catch {} tt.ws = null; } if (final) { tt.status = 'כבוי'; ttEmit(); } }
function onTikTok(msg) {
  const ev = msg.event || msg.type || msg.name; const d = msg.data || msg;
  tt.seen++; tt.lastEvt[ev] = (tt.lastEvt[ev] || 0) + 1;
  if (tt.seen <= 30 || tt.lastEvt[ev] === 1) console.log('[tt]', ev, JSON.stringify(d).slice(0, 300));
  if (tt.status !== 'מחובר ✓') { tt.status = 'מחובר ✓'; ttEmit(); }
  const u = d.user || d.author || (d.uniqueId ? { uniqueId: d.uniqueId, nickname: d.nickname } : null);
  const v = viewer(u); const name = v ? v.name : (u?.nickname || u?.uniqueId || 'מישהו');
  if (ev === 'chat' || ev === 'comment') { const text = d.comment || d.text || d.message || ''; if (v) { v.msgs++; } saveViewers(); emit('chatmsg', { name, text, uid: u?.uniqueId }); onChat(name, text, u?.uniqueId); }
  else if (ev === 'gift') { if (d.repeatEnd === false) return; const n = d.repeatCount || 1, dia = (d.diamondCount || 0) * n; if (v) { v.gifts += n; v.diamonds += dia; } saveViewers(); emit('chatmsg', { name, text: `🎁 ${d.giftName || 'מתנה'} ×${n} (${dia}💎)`, uid: u?.uniqueId, kind: 'gift' }); onGift(name, d.giftName, n, dia); }
  else if (ev === 'follow') { emit('chatmsg', { name, text: '➕ עוקב חדש', kind: 'follow' }); onEvent(`${name} התחיל לעקוב`); }
  else if (ev === 'like') { tt.likes = (tt.likes || 0) + (d.likeCount || 1); if (headGame.on && headGame.likes) throwTomato(Math.min(5, d.likeCount || 1), 'like'); }
  else if (ev === 'member' || ev === 'join') { emit('chatmsg', { name, text: '👋 נכנס', kind: 'join' }); if (v && v.msgs + v.gifts > 0) onEvent(`${name} חזר ללייב (מכיר אותו: ${v.msgs} הודעות, ${v.gifts} מתנות)`); }
  else if (ev === 'battle' || ev === 'linkMicBattle' || ev === 'linkMicArmies' || ev === 'battleArmies') {
    try { const js = JSON.stringify(d); const me = (tt.user || '').toLowerCase(); const cands = [...js.matchAll(/"(?:uniqueId|nickname|nickName|displayName)"\s*:\s*"([^"]{2,40})"/g)].map(m => m[1]).filter(x => x.toLowerCase() !== me);
      if (cands.length && !opp.auto_locked) { const nick = cands.find(x => /[^\w.]/.test(x)) || cands[0]; const handle = cands.find(x => /^[\w.]{2,40}$/.test(x)) || ''; if (nick && nick !== opp.name) { opp = { ...opp, name: nick, handle, detected: Date.now() }; saveJ('opponent.json', opp); emit('opponent', opp); emit('status', { msg: `👤 זוהה יריב בקרב: ${nick}` });
          // his stream is NEVER put on our stage by itself — the rival is only remembered for the "זהה וייצר" button
          if (handle) emit('status', { msg: `🥊 היריב בקרב: ${nick} (${handle}) — לחץ "זהה וייצר"` }); } } } catch {}
    emit('battle', d); onBattle(d); }
  else if (ev === 'roomInfo' || ev === 'connected') { tt.status = 'מחובר ✓ ' + (d.viewerCount != null ? d.viewerCount + ' צופים' : ''); if (d.roomId) tt.roomId = String(d.roomId); ttEmit(); }
}

// ---------- the auto brain: decide, answer from the bank, generate only when needed ----------
let brainBusy = false, lastAutoAt = 0, pendingChat = [];
const AUTO_GAP_MS = 12000;
function onChat(name, text, uid) { pushConvo('chat', `${name}: ${text}`); if (convoSettings.autoReply) { pendingChat.push({ name, text, uid, t: Date.now() }); if (pendingChat.length > 12) pendingChat.shift(); autoTick(); } }
function onGift(name, gift, n, dia) { pushConvo('chat', `🎁 ${name} שלח ${gift} ×${n}`); recentGifters.push({ name, gift, dia, t: Date.now() }); if (recentGifters.length > 30) recentGifters.shift();
  if (convoSettings.autoReply) { const pb = (playbook.phases.gift || {}).lines || []; const tmpl = pb.length ? pb[Math.floor(Math.random() * pb.length)][auto.lang === 'en' ? 'en' : 'he'] : ''; const line = tmpl && hasSlot(tmpl) ? tmpl.replace(/\{שם\}|\{name\}/g, name) : (auto.lang === 'en' ? `Thank you ${name} for the ${gift}!` : `תודה ל${name} על ה${gift}`); show.lastNameAt = Date.now(); autoSay(line, { priority: true, hint: `thank ${name} warmly for the gift "${gift}" (${dia} diamonds)` }); } }
function onEvent(text) { pushConvo('chat', text); if (convoSettings.autoReply) { pendingChat.push({ name: '', text: `[אירוע] ${text}`, t: Date.now() }); autoTick(); } }
function onBattle(d) { const s = JSON.stringify(d).slice(0, 200); pushConvo('chat', `[קרב] ${s}`); }
async function autoTick() {
  if (brainBusy || !pendingChat.length) return;
  if (Date.now() - lastAutoAt < AUTO_GAP_MS) { setTimeout(autoTick, AUTO_GAP_MS - (Date.now() - lastAutoAt) + 200); return; }
  brainBusy = true;
  try {
    const batch = pendingChat.splice(0); lastAutoAt = Date.now();
    const recent = convo.slice(-14).map(x => (x.who === 'ariel' ? 'CHINO' : x.who === 'opponent' ? 'OPPONENT' : 'CHAT') + ': ' + x.text).join('\n');
    const known = bank.slice().sort((a, b) => b.count - a.count).slice(0, 60).map(b => b.text);
    const r = await brain([{ text: `${persona.text}
${knowledgeDigest()}${lessonsDigest()}${namesDigest()}
You run a TikTok LIVE as CHINO. New chat messages/events just arrived. Decide whether to respond and what to say. Rules:
- Respond to things worth responding to: greetings, questions, jokes, people saying your name, new followers, people you know coming back. Ignore spam, emoji-only, or things already answered.
- LANGUAGE: answer in the language you were spoken to — Hebrew to Hebrew, English to English (natural, casual, native-sounding). If you lack a good Hebrew line, English is fine. Never mix clumsily. Max 14 words, first person. Use people's names when they wrote something (copy names EXACTLY).
- STRONGLY prefer a line from the READY list when it fits (copy it EXACTLY, word for word) — it plays instantly. Only write a new line when nothing ready fits.
- Never cruel, never sexual, no insults about looks/race/religion.
Conversation so far:
${recent}
NEW:
${batch.map(b => (b.name ? b.name + ': ' : '') + b.text).join('\n')}
READY lines: ${JSON.stringify(known)}
Return JSON: {"respond": true/false, "line": "what CHINO says or empty", "reused": true/false, "emotion": "one English word", "face": "short English description"}` }]);
    if (r && r.respond && r.line) await autoSay(r.line, { emotion: r.emotion, face: r.face });
  } catch (e) { emit('status', { msg: 'מוח: ' + e.message }); }
  brainBusy = false; if (pendingChat.length) setTimeout(autoTick, 500);
}
async function autoSay(line, opts = {}) {
  if(training.observeOnly)return;
  line = String(line || '').trim(); if (!line) return;
  if (deskMuted || set.mode === 'off') return;
  if (set.mode === '3d') { if (engine.online) { try { await engineSay(line, { emotion: opts.emotion, priority: !!opts.priority, source: 'brain' }); } catch (e) { emit('status', { msg: 'מנוע: ' + e.message }); } } return; }
  if (bankHit(line, true)) { pushConvo('ariel', line); return; }
  // not in the bank: let the persona rewrite lightly (keeps names), then generate + play + save
  let d = { line, emotion: opts.emotion || 'confident', face: opts.face || '' };
  try { const x = await toLion(line); if (x.line) d = { ...d, ...x }; } catch {}
  if (bankHit(d.line, true)) { pushConvo('ariel', d.line); return; }
  if (running + waiting.length >= 3) { emit('status', { msg: `⏳ עמוס (3 סרטונים בייצור) — מדלג על: "${d.line}"` }); return; }   // cost guard: never pile up generations
  pushConvo('ariel', d.line); emit('status', { msg: `🤖 אוטומט מייצר: "${d.line}"` });
  generateLine(d.line, d, { play: true }).catch(e => emit('status', { msg: 'שגיאה: ' + e.message }));
}


// ---------- LEARN-FROM-LIVE: watch another streamer's live and extract Chino's repertoire ----------
let training = { ...{ on: false, showTicker: true, lang: 'en', observeOnly:true, localTranscription:true }, ...loadJ('training.json', {}) };
let study = { on: false, name: '', startedAt: 0, chunks: 0, lines: [], lessons: loadJ('lessons.json', { styles: [], lines: [], battle: [], chat: [], sessions: [] }) };
let studyQueue = {buf:[],analyzing:false};           // transcript lines since last analysis
let studyTimer = null;
function studyEmit() { emit('study', { on: study.on, name: study.name, chunks: study.chunks, lines: study.lines.length, lessons: { styles: study.lessons.styles.length, lines: study.lessons.lines.length, battle: study.lessons.battle.length, chat: study.lessons.chat.length } }); }
function studyStart(name) {
  study.on = true; study.name = String(name || 'לייב').trim(); study.startedAt = Date.now(); study.chunks = 0; study.lines = []; studyQueue.buf = [];
  clearInterval(studyTimer); studyTimer = setInterval(() => studyAnalyze().catch(e => emit('status', { msg: 'ניתוח למידה: ' + e.message })), 150000);
  emit('status', { msg: `🎓 לומד מהלייב של ${study.name}…` }); studyEmit();
}
async function studyStop() {
  if (!study.on) return;
  clearInterval(studyTimer); studyTimer = null;
  await studyAnalyze(true).catch(() => {});
  study.on = false; studyEmit(); emit('status', { msg: `🎓 הלמידה מ-${study.name} הסתיימה` });
}
function studyContext() {   // who is he talking to right now? (from the tik.tools watcher of the studied streamer)
  const w = watchers[study.name]; if (!w) return '';
  const names = [...new Set((w.timeline || []).slice(-40).filter(x => x.k === 'chat' || x.k === 'gift').map(x => x.name).filter(Boolean))].slice(-12);
  const b = w.battle ? ` BATTLE NOW: he has ${w.battle.mine} vs ${w.battle.theirs} (${w.battle.mine > w.battle.theirs ? 'winning' : w.battle.mine < w.battle.theirs ? 'LOSING' : 'tied'}, ${w.battle.left}s left).` : '';
  return `Context: streamer handle "${study.name}"${sx.ownerNick ? ` (display name "${sx.ownerNick}")` : ''}. ${w.opp ? `He is currently in a BATTLE against "${w.opp}".` : ''}${b} Recent chat names (for spelling names you hear): ${names.join(', ') || 'none'}.`;
}
let brainPausedUntil = 0, brainPauseMsg = '';
function brainFail(e) {   // billing/quota problems: pause the learning calls for 5 minutes and say it clearly (once)
  const m = String(e && e.message || e);
  const failure=classifyProviderFailure(m);if(failure){providerState.blocked=failure;providerState.until=failure==='quota'?Date.now()+300000:0;saveJ('provider_state.json',providerState);}
  if (/depleted|billing|quota|Rate limit|429|RESOURCE_EXHAUSTED/i.test(m)) { brainPausedUntil = Date.now() + 300000; if (brainPauseMsg !== m.slice(0, 60)) { brainPauseMsg = m.slice(0, 60); emit('status', { msg: /depleted|billing/i.test(m) ? '💳 נגמרו הקרדיטים במפתח Gemini — צריך להטעין ב-AI Studio (הלמידה מושהית)' : '⏳ מכסת Gemini נגמרה להיום — הלמידה מושהית 5 דק׳' }); learnLog('insight', /depleted|billing/i.test(m) ? '💳 נגמרו הקרדיטים — הטען ב-AI Studio כדי להמשיך ללמוד' : '⏳ מכסה — מחכים'); } return true; }
  return false;
}
async function studyChunk(b64, mime='audio/webm', capturedAt=Date.now(), evidenceId=null) {
  if(!study.on)return;
  study.chunks++;
  try {
    if(!training.localTranscription || !localASR)throw new Error('Local transcription unavailable');
    const r=await localASR.transcribe(b64);
    const rows=transcriptRows(r.lines,{src:study.name,capturedAt,evidenceId,transcriptionProvider:'local-whisper-base',verified:false});
    for(const row of rows){
      const saved=evidence.append('transcript',row);if(!saved)throw new Error('evidence_write_failed');
      study.lines.push(row);studyQueue.buf.push(row);emit('studyline',row);
    }
    if(studyQueue.buf.length>1500)studyQueue.buf.splice(0,studyQueue.buf.length-1500);
    if(study.lines.length>2000)study.lines.splice(0,study.lines.length-2000);
  }catch(e){console.log('[study]',e.message)}
  studyEmit();
}

// ---------- TRAINING SHOW: Chino listens to the studied live and answers it on OUR live ----------
let trainBusy = false, lastTrainAt = 0;

// an action the brain chose: play an overlay character or a head effect for a few seconds
let actionTimer = null;
function doAction(a) {
  try {
    if (a.startsWith('fx:')) { const fx = a.slice(3); Object.assign(headState, { on: true, fx }); emit('head', headState); clearTimeout(actionTimer); actionTimer = setTimeout(() => { headState.on = false; emit('head', headState); }, 9000); }
    else { const j = P('media', 'overlays', a.replace(/[^\w-]/g, '') + '.json'); if (fs.existsSync(j)) { emit('overlay', { id: a, loop: false, webm: '/media/overlays/' + a + '.webm', track: JSON.parse(fs.readFileSync(j, 'utf8')) }); } }
    emit('training', { action: a }); learnLog('action', `פעולה: ${a}`);
  } catch (e) { console.log('[action]', e.message); }
}
// learning log for the dashboard: everything Chino learns, in order
let learnlog = loadJ('learnlog.json', []);
function learnLog(kind, text, extra = {}) { const row = { t: Date.now(), kind, text, src: study.name || '', ...extra }; learnlog.push(row); if (learnlog.length > 1000) learnlog.shift(); saveJ('learnlog.json', learnlog); emit('learnlog', row); }

async function trainingReply(row) {
  if(training.observeOnly)return;
  if (trainBusy || Date.now() - lastTrainAt < 9000) return;      // don't talk over himself
  trainBusy = true;
  try {
    emit('training', { heard: row.text, who: row.who });
    pushConvo('opponent', row.text);
    const known = bank.slice().sort((a, b) => b.count - a.count).slice(0, 80).map(b => b.text);
    const recent = convo.slice(-10).map(x => (x.who === 'ariel' ? 'CHINO' : 'STREAMER') + ': ' + x.text).join('\n');
    const r = await brain([{ text: `${persona.text}
${knowledgeDigest()}${lessonsDigest()}
TRAINING SHOW. CHINO is on his own live, learning in public from a top BATTLE streamer. Everything he says must be ABOUT what he is watching/learning right now — never random filler.
FOCUS: the battle itself (two players facing off) is what matters most. React strongly to battle moments (hype, scores, trash talk, gifts turning the tide, the opponent's moves). Between battles, react less — only to something really good.
Two kinds of lines: (a) talk back to the streamer like he's in front of you, (b) tell YOUR audience what you just learned ("wait, did you see how he..."), like a student-commentator. Mix both.
LANGUAGE FOR THIS SESSION: ${training.lang === 'he' ? 'Hebrew' : 'ENGLISH (the streamer speaks English; answer and comment in natural, confident English with Israeli swagger)'}. The 'learned' ticker line also in that language. He is listening to another streamer ("${study.name}") and reacts to him out loud as if that streamer were talking to him — like a student answering back. The audience of CHINO's live is watching him learn.
Decide: is there a GOOD reaction to what the streamer just said? React when it's a greeting, a question, a joke, a brag, hype, or something you can play off; stay silent on filler, song lyrics, or unclear speech.
LANGUAGE: answer in the language you were spoken to — Hebrew to Hebrew, English to English (natural, casual, native-sounding). If you lack a good Hebrew line, English is fine. Never mix clumsily. Max 12 words, first person, funny/confident, never cruel/sexual/hateful.
Prefer a READY line when it fits (copy EXACTLY) — it plays instantly. Otherwise a new line.
Recent:
${recent}
STREAMER just said: "${row.text}"
READY: ${JSON.stringify(known)}
Available ACTIONS Chino can also do (pick at most one, only when it really fits the moment): "boxer1" (boxer character with the streamer's head when he brags/threatens), "boxer3" (punch to camera when he gets hyped), "fx:crown" (crown the streamer when he says something kingly/wins), "fx:cry" (crying when he complains/loses), "fx:shake" (shake when he is shocked), "fx:bobble" (silly bobble when he says something dumb), "none".
Return JSON: {"respond": true/false, "line": "...", "action": "boxer1|boxer3|fx:crown|fx:cry|fx:shake|fx:bobble|none", "learned": "one short Hebrew sentence: what Chino just learned from this moment (for the on-screen ticker), or empty", "emotion": "one English word", "face": "short English description"}` }]);
    if (r && r.action && r.action !== 'none') doAction(r.action);
    if (r && r.learned) { emit('training', { learned: r.learned }); learnLog('insight', r.learned, { heard: row.text }); }
    if (r && r.respond && r.line) { lastTrainAt = Date.now(); learnLog('reply', r.line, { heard: row.text }); await autoSay(r.line, { emotion: r.emotion, face: r.face }); }
  } catch (e) { console.log('[training]', e.message); }
  trainBusy = false;
}


// ---------- VISION: learn how the streamer MOVES (gestures, energy, expressions) and how he uses names ----------
let moves = loadJ('moves.json', { gestures: [], energy: [], names: [], sessions: 0 });
async function studyVision(jpgB64, audioB64, amime = 'audio/webm') {
  if (!study.on || Date.now() < brainPausedUntil) return;
  try {
    const parts = [{ inline_data: { mime_type: 'image/jpeg', data: jpgB64 } }];
    if (audioB64) parts.push({ inline_data: { mime_type: amime, data: audioB64 } });
    parts.push({ text: `You are studying a top TikTok BATTLE streamer ("${study.name}") to teach CHINO (a lion-king host character) how to MOVE and PERFORM. Look at the frame (and listen to the audio if given).
Return JSON:
"gestures": up to 3 concrete body/face moves you see (English, specific: "leans into camera and points with both index fingers", "throws head back laughing", "raises both arms when score jumps").
"energy": one of low|medium|high|explosive, plus a 5-word note.
"expression": his facial expression in 3-6 words.
"context": battle|between|unknown — is a battle on screen (split screen, two players, score bar)?
"names": if you can HEAR him say a name: {"name":"...","to":"chat|opponent|unknown"} entries (who he addressed), else [].
"chino_move": ONE sentence in English describing how CHINO should move to copy this energy on his throne (paws, head, body, face) — keep it doable for a seated lion.
Return JSON: {"gestures":[...],"energy":"...","energy_note":"...","expression":"...","context":"...","names":[...],"chino_move":"..."}` });
    const r = await brain(parts);
    const ts = Date.now(), src = study.name;
    for (const g of (r.gestures || [])) moves.gestures.push({ t: ts, src, text: String(g), ctx: r.context || 'unknown' });
    if (r.energy) moves.energy.push({ t: ts, src, level: r.energy, note: r.energy_note || '', ctx: r.context || 'unknown', expr: r.expression || '' });
    for (const n of (r.names || [])) if (n && n.name) moves.names.push({ t: ts, src, name: n.name, to: n.to || 'unknown' });
    if (r.chino_move) { moves.chino = moves.chino || []; moves.chino.push({ t: ts, src, text: String(r.chino_move), ctx: r.context || 'unknown', energy: r.energy || '' }); if (moves.chino.length > 200) moves.chino.splice(0, moves.chino.length - 200); }
    moves.sessions++;
    for (const k of ['gestures', 'energy', 'names']) if (moves[k].length > 400) moves[k].splice(0, moves[k].length - 400);
    saveJ('moves.json', moves);
    const line = `${r.context === 'battle' ? '⚔️ ' : ''}${r.energy || ''}: ${(r.gestures || []).slice(0, 2).join('; ')}${r.expression ? ' — ' + r.expression : ''}`;
    learnLog('body', line); emit('vision', { energy: r.energy, context: r.context, gestures: r.gestures, expression: r.expression, names: r.names, chino_move: r.chino_move });
  } catch (e) { if (!brainFail(e)) console.log('[vision]', e.message); }
}
// how Chino should move, learned: a digest injected into the video prompts
function moveStyle(kind) {
  const C = (moves.chino || []);
  if (!C.length) return '';
  const pool = kind === 'battle' ? C.filter(x => x.ctx === 'battle') : C;
  const pick = (pool.length ? pool : C).slice(-12);
  const hi = pick.filter(x => /high|explosive/.test(x.energy));
  const chosen = (kind === 'battle' && hi.length ? hi : pick)[Math.floor(Math.random() * (kind === 'battle' && hi.length ? hi : pick).length)];
  return chosen ? ` Performance style learned from top streamers: ${chosen.text}` : '';
}
function namesDigest() {
  const N = moves.names.slice(-40); if (!N.length) return '';
  const toChat = N.filter(x => x.to === 'chat').length, toOpp = N.filter(x => x.to === 'opponent').length;
  return `\nNAME USAGE learned: top hosts say viewers' names often (${toChat} times to chat, ${toOpp} times to the opponent in the sample). Use the chat person's name when answering chat; use the opponent's name when answering the opponent.`;
}

let lastStudyAnalyzeAt = 0;
async function studyBrain(batch,events) {
  const r=await fetch('http://127.0.0.1:7780/api/director/observations/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({batch:batch.map(x=>({who:x.who,t:x.t,text:String(x.text||'').slice(0,500)})),events:events.slice(-20).map(x=>({k:x.k,t:x.t,text:String(x.text||'').slice(0,300)}))}),signal:AbortSignal.timeout(30000)});
  const result=await r.json();if(!r.ok)throw new Error(/^[a-z0-9_]+$/.test(result.error||'')?result.error:'openai_analysis_unavailable');return result;
}
async function studyAnalyze(final=false) {
  if(studyQueue.buf.length<(final?1:6))return;
  return analyzeBatch(studyQueue,async batch=>{
    const since=batch[0]?.t||Date.now();
    const events=(watchers[study.name]?.timeline||[]).filter(x=>x.t>=since-15000).slice(-120);
    const input=evidence.append('analysis_input',{src:study.name,batch,events});
    if(!input)throw new Error('evidence_write_failed');
    const result=await studyBrain(batch,events);
    for(const key of ['lines','styles','battle','chat','situations'])if(result[key]!==undefined&&!Array.isArray(result[key]))throw new Error('invalid_analysis');
    return {sourceId:input.id,result};
  },async ({sourceId,result},batch)=>{
    const saved=evidence.append('analysis_candidate',{sourceId,src:study.name,status:'unvalidated',...result});
    if(!saved)throw new Error('evidence_write_failed');
    lastStudyAnalyzeAt=Date.now();studyEmit();
    emit('status',{msg:'נשמר ניתוח מועמד לבדיקה — עדיין לא מיומנות מאומתת'});
  },{maxRows:20});
}
// what Chino learned feeds his brain: a compact digest injected into every decision
function lessonsDigest() {
  const L = study.lessons; if (!L.lines.length && !L.styles.length) return '';
  const st = L.styles.slice(-6).map(x => '- ' + x.text).join('\n');
  const bt = L.battle.slice(-4).map(x => '- ' + x.text).join('\n');
  const ln = L.lines.slice(-40).map(x => `[${x.kind}] ${x.text}`).join('\n');
  const ix = (L.interactions || []).slice(-8).map(x => `- said "${x.said}" to ${x.to}${x.name ? ' (' + x.name + ')' : ''} → ${x.reaction} [${x.result}]`).join('\n');
  return `\nWHAT CHINO LEARNED FROM WATCHING TOP STREAMERS (use this style; these LEARNED lines are also good to say, in his own voice):\nStyle:\n${st}\nBattle tactics:\n${bt}\n${ix ? 'What works (cause → effect, who he addressed):\n' + ix + '\n' : ''}Learned lines:\n${ln}\n`;
}

// ======================================================================
// HEADLESS STUDY: pull the studied streamer's LIVE straight from TikTok's CDN (no browser, NO sound on this PC),
// split it into 10s audio chunks + a frame every 20s, and feed the study brain. Chat/gifts/battles arrive in parallel
// from tik.tools (the department watcher) → one fused timeline: what he said ↔ what the chat did.
// ======================================================================
let stream = { ...{ auto: false, user: '' }, ...loadJ('stream.json', {}) };
let sx = { on: false, user: '', roomId: '', url: '', title: '', proc: null, status: 'כבוי', chunks: 0, frames: 0, startedAt: 0, lastData: 0, dir: P('media', 'rejected', 'stream'), timer: null, retry: null, lastAudioB64: null };
const TT_H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
function sxEmit() { emit('stream', { on: sx.on, user: sx.user, status: sx.status, chunks: sx.chunks, frames: sx.frames, live: !!sx.proc, title: sx.title, opp: (watchers[sx.user] || {}).opp || '' }); }
let FFMPEG = '';
function ffmpegPath() {
  return new Promise(res => { if (FFMPEG) return res(FFMPEG);
    execFile('py', ['-3.13', '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { windowsHide: true }, (e, out) => { FFMPEG = (!e && (out || '').trim()) || 'ffmpeg'; res(FFMPEG); }); });
}
async function roomIdOf(user) {
  const w = watchers[user]; if (w && w.roomId) return w.roomId;
  try { const r = await fetch(`https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=${encodeURIComponent(user)}`, { headers: TT_H }); const j = await r.json(); const id = j?.data?.user?.roomId || j?.data?.liveRoom?.roomId || j?.data?.roomId; if (id) return String(id); } catch {}
  if (!watchers[user]) watchStart(user);                       // the watcher gets roomInfo within a few seconds
  for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 1000)); if (watchers[user]?.roomId) return watchers[user].roomId; }
  return '';
}
async function roomInfoRaw(roomId) {
  const r = await fetch(`https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=${roomId}`, { headers: TT_H });
  const raw = await r.text(); let j = {}; try { j = JSON.parse(raw); } catch {}
  return { raw, d: j?.data || {} };
}
const rivalCache = new Map();   // rival anchor id -> @handle
const rosterAlive = new Map();  // user -> {alive, t}  (a minute's cache for the roster chips)
async function rivalHandleOf(id) {   // the rival of OUR battle: TikTok tells us only his id; his room tells us his @
  if (!id) return ''; if (rivalCache.has(id)) return rivalCache.get(id);
  let h = ''; try { const r = await fetch(`https://webcast.tiktok.com/webcast/room/info_by_user/?aid=1988&user_id=${id}`, { headers: TT_H }); const raw = await r.text(); h = (raw.match(/"display_id":"([^"]{2,40})"/) || raw.match(/"unique_id":"([^"]{2,40})"/) || [])[1] || ''; } catch {}
  if (h) rivalCache.set(id, h); return h;
}
async function ttRoomVideo(user, roomId) {   // → {url, roomId, title, alive} or null
  if (!settings.tiktoolsKey) return null;
  try { const r = await fetch('https://api.tik.tools/webcast/room_video', { method: 'POST', headers: { 'x-api-key': settings.tiktoolsKey, 'Content-Type': 'application/json' }, body: JSON.stringify(user ? { unique_id: user } : { room_id: roomId }), signal: AbortSignal.timeout(12000) });
    const j = await r.json(); const d = j?.data; if (!d || !d.alive) return d ? { alive: false, roomId: d.room_id || roomId || '', title: d.title || '' } : null;
    const su = d.stream_urls || {}; const url = su.hd?.flv || su.HD1?.flv || su.origin?.flv || su.sd?.flv || su.uhd?.flv || d.flvPullUrl || su.hd?.hls || d.hlsPullUrl || '';
    return { alive: true, url, roomId: String(d.room_id || roomId || ''), title: d.title || '', ownerId: String(d.owner?.id_str || d.owner?.id || ''), ownerNick: d.owner?.nickname || '', avatar: (d.owner?.avatar_large || d.owner?.avatar_medium || d.owner?.avatar_thumb)?.url_list?.[0] || '' };
  } catch (e) { console.log('[tik.tools room_video]', e.message); return null; }
}
async function streamUrlOf(roomId) {
  const { raw, d } = await roomInfoRaw(roomId); const su = d.stream_url || {}; const flv = su.flv_pull_url || {};
  const url = flv.HD1 || flv.SD1 || flv.SD2 || flv.FULL_HD1 || Object.values(flv)[0] || su.hls_pull_url || '';
  sx.ownerId = String(d.owner?.id_str || (raw.match(/"owner":\{[^{}]*?"id_str":"(\d+)"/) || [])[1] || sx.ownerId || ''); sx.ownerNick = d.owner?.nickname || sx.ownerNick || '';
  return { url, status: d.status, title: d.title || '' };     // status 2 = live, 4 = ended
}
// BATTLE STATE straight from TikTok: who he fights (rival id), live scores, time left. Ids are parsed from the raw text (they exceed JS number precision).
let lastBattleId = '', lastLead = '';
async function sxPollBattle() {
  if (!sx.on || !sx.proc || !sx.roomId) return;
  const w = watchers[sx.user]; if (!w) return;
  try {
    const { raw } = await roomInfoRaw(sx.roomId);
    const rival = (raw.match(/"rival_anchor_id":"?(\d{6,})"?/) || [])[1] || '';
    const bid = (raw.match(/"battle_id":"?(\d{6,})"?/) || [])[1] || '';
    const finished = (raw.match(/"finished":(\d)/) || [])[1] === '1';
    const start = +((raw.match(/"start_time":(\d+)/) || [])[1] || 0), dur = +((raw.match(/"duration":(\d+)/) || [])[1] || 0);
    const scores = [...raw.matchAll(/\{"score":(\d+),"user_id":"?(\d{6,})"?\}/g)].map(m => ({ score: +m[1], id: m[2] }));
    const mine = scores.find(s => s.id === sx.ownerId)?.score, theirs = scores.find(s => s.id !== sx.ownerId)?.score;
    const left = start && dur ? Math.max(0, Math.round(start + dur - Date.now() / 1000)) : 0;
    const inBattle = !!rival && !finished && (left > 0 || mine != null);
    const prev = w.battle || {};
    w.battle = inBattle ? { id: bid, rivalId: rival, mine: mine ?? 0, theirs: theirs ?? 0, left, t: Date.now() } : null;
    if (inBattle && rival && !w.opp && w.oppById?.[rival]) { w.opp = w.oppById[rival]; w.oppAt = Date.now(); }   // nickname comes with the linkMicBattle event
    const tl = x => { w.timeline = w.timeline || []; w.timeline.push(x); if (w.timeline.length > 500) w.timeline.splice(0, w.timeline.length - 500); };
    if (inBattle && bid && bid !== lastBattleId) { lastBattleId = bid; lastLead = ''; tl({ t: Date.now(), k: 'battle', text: `BATTLE STARTED vs ${w.opp || 'rival'} (${dur}s)` }); learnLog('battle', `⚔️ קרב חדש התחיל${w.opp ? ' מול ' + w.opp : ''} (${dur} שנ׳)`); sxEmit(); }
    if (inBattle) { const lead = mine > theirs ? 'winning' : mine < theirs ? 'losing' : 'tied'; if (lead !== lastLead || Date.now() - (w.lastScoreLog || 0) > 60000) { lastLead = lead; w.lastScoreLog = Date.now(); tl({ t: Date.now(), k: 'battle', text: `SCORE ${mine} vs ${theirs} (${lead}, ${left}s left)` }); } }
    if (!inBattle && prev.id) { const won = prev.mine > prev.theirs; tl({ t: Date.now(), k: 'battle', text: `BATTLE ENDED — he ${won ? 'WON' : 'LOST'} ${prev.mine} vs ${prev.theirs}` }); learnLog('battle', `🏁 הקרב נגמר — ${won ? 'ניצח' : 'הפסיד'} ${prev.mine} מול ${prev.theirs}`); w.opp = ''; sxEmit(); }
  } catch (e) { console.log('[battle poll]', e.message); }
}
setInterval(() => sxPollBattle().catch(() => {}), 20000);
async function sxStart(user) {
  user = String(user || '').replace(/^@/, '').trim(); if (!user) throw new Error('חסר שם סטרימר');
  if (sx.on && sx.user === user) return;
  await sxStop(false);
  sx = { ...sx, on: true, user, roomId: '', url: '', title: '', chunks: 0, frames: 0, startedAt: Date.now(), lastData: 0, lastAudioB64: null, status: 'מחפש את השידור…' };
  // an ffmpeg left over from a previous server run would keep writing into the same folder — stop it first
  if (process.platform === 'win32') await new Promise(r => execFile('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'ffmpeg*' -and $_.CommandLine -like '*rejected*stream*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { windowsHide: true, timeout: 15000 }, () => r()));
  fs.mkdirSync(sx.dir, { recursive: true }); for (const f of fs.readdirSync(sx.dir)) { try { fs.unlinkSync(path.join(sx.dir, f)); } catch {} }
  if (!study.on || study.name !== user) studyStart(user);
  if (!watchers[user]) watchStart(user);                        // chat/gifts/battles of the same live, in parallel
  clearInterval(sx.timer); sx.timer = setInterval(sxIngest, 3000);
  sxEmit(); sxConnect().catch(e => { sx.status = 'שגיאה: ' + e.message; sxEmit(); });
}
async function sxStop(final = true) {
  clearTimeout(sx.retry); sx.retry = null; clearInterval(sx.timer); sx.timer = null;
  if (sx.proc) { try { sx.proc.kill(); } catch {} sx.proc = null; }
  sx.on = false; sx.status = 'כבוי'; sxEmit();
  if (final) await studyStop().catch(() => {});
}
async function sxConnect() {
  if (!sx.on) return;
  const roomId = sx.roomId || await roomIdOf(sx.user);
  if (!roomId) { sx.status = `${sx.user} לא בלייב כרגע — בודק שוב בעוד דקה`; sxEmit(); sx.retry = setTimeout(() => sxConnect().catch(() => {}), 60000); return; }
  sx.roomId = roomId;
  let { url, status, title } = await streamUrlOf(roomId).catch(() => ({}));
  if (!url) { const v = await ttRoomVideo(sx.user, roomId); if (v && v.alive && v.url) { url = v.url; status = 2; title = v.title; sx.roomId = v.roomId || roomId; if (v.ownerId) sx.ownerId = v.ownerId; if (v.ownerNick) sx.ownerNick = v.ownerNick; } }
  if (!url || status === 4) { sx.roomId = ''; sx.status = `${sx.user} סיים את הלייב — ממתין שיחזור`; sxEmit(); sx.retry = setTimeout(() => sxConnect().catch(() => {}), 60000); return; }
  sx.url = url; sx.title = title;
  const ff = await ffmpegPath();
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-rw_timeout', '20000000', '-i', url,
    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'segment', '-segment_time', '10', '-reset_timestamps', '1', path.join(sx.dir, 'a_%06d.mp3'),
    '-map', '0:v:0', '-an', '-vf', 'fps=1/20,scale=512:-2', '-q:v', '4', '-f', 'image2', path.join(sx.dir, 'f_%06d.jpg')];
  const p = spawn(ff, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  sx.proc = p; sx.status = `מחובר לשידור ✓ ${title ? '· ' + title : ''}`; sxEmit();
  emit('status', { msg: `📡 מאזין ללייב של ${sx.user} ישירות (בלי סאונד אצלך)` });
  let err = ''; p.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-2000); });
  p.on('exit', code => { if (sx.proc !== p) return; sx.proc = null; console.log('[stream] ffmpeg exit', code, err.slice(-300)); if (!sx.on) return; sx.status = 'השידור נותק — מתחבר מחדש…'; sxEmit(); sx.roomId = ''; sx.retry = setTimeout(() => sxConnect().catch(() => {}), 8000); });
}
// HIS MUSIC: every ~45s one chunk goes to Shazam → his playlist (what a real battle live sounds like), playable on our Spotify
let music = loadJ('music.json', { songs: [], last: null });     // songs: [{title, artist, spotify, genre, src, count, first, last}]
let musicBusy = false, lastMusicProbe = 0;
function musicEmit() { emit('music', { songs: music.songs.slice().sort((a, b) => b.last - a.last).slice(0, 40), last: music.last }); }
function musicProbe(buf) {
  if (musicBusy || Date.now() - lastMusicProbe < 45000) return; musicBusy = true; lastMusicProbe = Date.now();
  const fp = path.join(sx.dir, 'probe.mp3'); try { fs.writeFileSync(fp, buf); } catch { musicBusy = false; return; }
  execFile('py', ['-3.13', P('tools', 'shazam.py'), fp], { windowsHide: true, timeout: 40000, encoding: 'utf8' }, (err, out) => {
    musicBusy = false; let j = null; try { j = JSON.parse(String(out || '').trim().split('\n').pop()); } catch {}
    if (!j || !j.ok) return;
    const key = norm(j.artist + ' ' + j.title); let s = music.songs.find(x => norm(x.artist + ' ' + x.title) === key);
    const now = Date.now(), fresh = !s;
    if (!s) { s = { title: j.title, artist: j.artist, spotify: j.spotify || '', genre: j.genre || '', src: sx.user, count: 0, first: now, last: 0 }; music.songs.push(s); }
    if (now - s.last > 240000) s.count++;                   // the same song heard again after 4+ minutes counts as another play
    s.last = now; s.spotify = s.spotify || j.spotify || ''; music.last = { title: s.title, artist: s.artist, t: now, src: sx.user };
    if (music.songs.length > 300) music.songs.sort((a, b) => b.count - a.count).splice(300);
    saveJ('music.json', music); musicEmit();
    const w = watchers[sx.user]; if (w) { w.timeline = w.timeline || []; w.timeline.push({ t: now, k: 'battle', text: `MUSIC: ${j.artist} — ${j.title}` }); }
    if (fresh) learnLog('music', `🎵 ${j.artist} — ${j.title}${j.genre ? ' (' + j.genre + ')' : ''}`);
  });
}
function musicDigest() {
  const S = music.songs.slice().sort((a, b) => b.count - a.count).slice(0, 12); if (!S.length) return '';
  const genres = [...new Set(S.map(x => x.genre).filter(Boolean))].slice(0, 4).join(', ');
  return `\nMUSIC top battle streamers play (${genres || 'mixed'}): ${S.map(x => `${x.artist} — ${x.title}`).join(' | ')}. When choosing or talking about music, this is the vibe.`;
}
function sxIngest() {
  if (!sx.on) return;
  let files; try { files = fs.readdirSync(sx.dir); } catch { return; }
  const aud = files.filter(f => /^a_\d+\.mp3$/.test(f)).sort(), img = files.filter(f => /^f_\d+\.jpg$/.test(f)).sort();
  // a segment is complete once the next one exists (ffmpeg writes them in order)
  for (const f of aud.slice(0, -1)) { const fp = path.join(sx.dir, f); try { const b=fs.readFileSync(fp),capturedAt=fs.statSync(fp).mtimeMs; if(b.length>3000){const saved=evidence.capture(b,'mp3',{src:sx.user,capturedAt});if(!saved)continue;sx.chunks++;sx.lastData=Date.now();sx.lastAudioB64=b.toString('base64');studyChunk(sx.lastAudioB64,'audio/mpeg',capturedAt,saved.id);if(!training.observeOnly)musicProbe(b);}fs.unlinkSync(fp); } catch (e) { console.log('[stream ingest]', e.message); } }
  for (const f of img.slice(0, -1)) { const fp = path.join(sx.dir, f); try { const b=fs.readFileSync(fp),capturedAt=fs.statSync(fp).mtimeMs;if(b.length>2000){const saved=evidence.capture(b,'jpg',{src:sx.user,capturedAt});if(!saved)continue;sx.frames++;if(!training.observeOnly)studyVision(b.toString('base64'),sx.lastAudioB64,'audio/mpeg');}fs.unlinkSync(fp); } catch {} }
  if (sx.proc && sx.lastData && Date.now() - sx.lastData > 90000) { console.log('[stream] stalled, restarting'); try { sx.proc.kill(); } catch {} }
  if (sx.chunks % 3 === 0) sxEmit();
}
// auto: the favorite streamer is studied headlessly whenever he is live
setInterval(async () => {
  if (!stream.auto || !stream.user) return;
  if (!sx.on) return sxStart(stream.user).catch(() => {});
  if (sx.user !== stream.user) {        // studying a stand-in: switch back the moment the favorite is live again
    const id = await roomIdOf(stream.user).catch(() => ''); if (id) { const { status } = await streamUrlOf(id).catch(() => ({})); if (status === 2) return sxStart(stream.user).catch(() => {}); }
  } else if (!sx.proc && Date.now() - sx.startedAt > 120000 && follow.freeLearn) {   // favorite offline → learn from the strongest battle streamer we are watching ("more like him")
    const cand = Object.values(watchers).filter(w => w.user !== stream.user && w.stats.battles > 0 && /מחובר/.test(w.status)).sort((a, b) => b.stats.diamonds - a.stats.diamonds)[0];
    if (cand) { emit('status', { msg: `📡 ${stream.user} לא בלייב — לומד בינתיים מ-${cand.user}` }); sxStart(cand.user).catch(() => {}); }
  }
}, 60000);
setTimeout(() => { if (stream.auto && stream.user) sxStart(stream.user).catch(() => {}); }, 6000);


// ======================================================================
// ANALYSIS DEPARTMENT: watch other streamers' lives (chat/gifts/battles via tik.tools),
// learn what works, and build Chino's character. Runs in the background, several lives at once.
// ======================================================================
let watchers = {};                                   // uniqueId -> {ws, status, since, stats, buf}
let knowledge = loadJ('knowledge.json', { streamers: {}, insights: [], triggers: [], lines: [], hooks: [], updated: 0 });
function knowEmit() { emit('dept', { watching: Object.values(watchers).map(w => ({ user: w.user, status: w.status, msgs: w.stats.msgs, gifts: w.stats.gifts, diamonds: w.stats.diamonds, battles: w.stats.battles })), insights: knowledge.insights.length, triggers: knowledge.triggers.length, lines: knowledge.lines.length, streamers: Object.keys(knowledge.streamers).length }); }
async function watchStart(user) {
  user = String(user || '').replace(/^@/, '').trim(); if (!user || watchers[user]) return;
  const w = watchers[user] = { user, ws: null, status: 'מתחבר…', since: Date.now(), stats: { msgs: 0, gifts: 0, diamonds: 0, battles: 0, follows: 0 }, buf: [], lastBattle: null, giftsByMinute: {} };
  knowEmit();
  let url;
  try { const r = await fetch('https://api.tik.tools/authentication/jwt?apiKey=' + encodeURIComponent(settings.tiktoolsKey), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_creators: [user], expire_after: 3600, max_websockets: 1 }) }); const j = await r.json(); url = `wss://api.tik.tools?uniqueId=${encodeURIComponent(user)}&jwtKey=${encodeURIComponent(j.data.token)}`; }
  catch { url = `wss://api.tik.tools?uniqueId=${encodeURIComponent(user)}&apiKey=${encodeURIComponent(settings.tiktoolsKey)}`; }
  const ws = new WebSocket(url); w.ws = ws;
  ws.onopen = () => { w.status = 'מחובר'; knowEmit(); };
  ws.onmessage = ev => { try { watchEvent(w, JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())); } catch {} };
  ws.onclose = ev => { w.ws = null; w.status = 'נותק ' + (ev.reason || ev.code || ''); knowEmit(); if (watchers[user]) setTimeout(() => { if (watchers[user]) { delete watchers[user]; watchStart(user); } }, 15000); };
  ws.onerror = () => { w.status = 'שגיאה'; knowEmit(); };
}
function watchStop(user) { const w = watchers[user]; if (!w) return; delete watchers[user]; try { w.ws && (w.ws.onclose = null, w.ws.close()); } catch {} knowEmit(); }
function watchEvent(w, msg) {
  const ev = msg.event || msg.type; const d = msg.data || msg; const t = Date.now(); const min = Math.floor(t / 60000);
  w.evs = w.evs || {}; w.evs[ev] = (w.evs[ev] || 0) + 1; if (w.evs[ev] === 1) console.log('[tt-ev]', w.user, ev, JSON.stringify(d).slice(0, 200));
  if (/battle|linkmic|armies|pk|match|versus/i.test(String(ev)) && !/^(battle|linkMicBattle|linkMicArmies|battleArmies)$/.test(ev)) { w.stats.battles++; w.lastBattle = d; w.buf.push({ t, k: 'battle', text: ev + ' ' + JSON.stringify(d).slice(0, 240) }); }
  const u = d.user || d.author || {}; const name = u.nickname || u.uniqueId || '';
  const tl = x => { w.timeline = w.timeline || []; w.timeline.push(x); if (w.timeline.length > 500) w.timeline.splice(0, w.timeline.length - 500); };   // read-only ring for the fused study timeline
  if (ev === 'chat' || ev === 'comment') { w.stats.msgs++; const row = { t, k: 'chat', name, text: d.comment || d.text || '' }; w.buf.push(row); tl(row); }
  else if (ev === 'gift') { if (d.repeatEnd === false) return; const n = d.repeatCount || 1, dia = (d.diamondCount || 0) * n; w.stats.gifts += n; w.stats.diamonds += dia; w.giftsByMinute[min] = (w.giftsByMinute[min] || 0) + dia; const row = { t, k: 'gift', name, text: `${d.giftName} x${n} (${dia})` }; w.buf.push(row); tl(row); }
  else if (ev === 'follow') { w.stats.follows++; const row = { t, k: 'follow', name }; w.buf.push(row); tl(row); }
  else if (ev === 'battle' || ev === 'linkMicBattle' || ev === 'linkMicArmies' || ev === 'battleArmies') { w.stats.battles++; w.lastBattle = d; const row = { t, k: 'battle', text: JSON.stringify(d).slice(0, 240) }; w.buf.push(row); tl(row); if (hunted[w.user]) hunted[w.user].battles++;
    // the rival HOST (not a top gifter): user objects that are not inside a "users"/"topViewers" list and are not the streamer himself
    try { const hosts = []; const walk = (o, under) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(x => walk(x, under)); return; } const id = String(o.id || o.userId || o.user_id || ''); if (o.nickname && id && !under) hosts.push({ id, nick: String(o.nickname), uid: String(o.uniqueId || o.display_id || '') }); for (const [k, v] of Object.entries(o)) walk(v, under || /^(users|topViewers|contributors|gifters)$/.test(k)); };
      walk(d.battleUsers || d.users || d, false);
      const ownerId = (sx.user === w.user && sx.ownerId) || ''; const me = w.user.toLowerCase();
      w.oppById = w.oppById || {}; for (const h of hosts) if (h.id !== ownerId && h.uid.toLowerCase() !== me) w.oppById[h.id] = h.nick;
      const rivalId = w.battle?.rivalId; const pick = hosts.find(h => rivalId ? h.id === rivalId : (h.id !== ownerId && h.uid.toLowerCase() !== me && h.nick.toLowerCase() !== me));
      if (pick && pick.nick !== w.opp) { w.opp = pick.nick; w.oppAt = t; tl({ t, k: 'battle', text: `battle vs ${pick.nick}` }); if (sx.on && sx.user === w.user) { sxEmit(); learnLog('battle', `⚔️ ${w.user} בקרב מול ${pick.nick}`); } } } catch {} }
  else if (ev === 'roomInfo') { w.status = 'מחובר · ' + (d.viewerCount ?? '?') + ' צופים'; if (d.roomId) w.roomId = String(d.roomId); }
  if (w.opp && !w.battle && t - (w.oppAt || 0) > 900000) w.opp = '';          // no live battle state: a battle is over after ~15 min without new battle events
  if (w.buf.length > 600) w.buf.splice(0, w.buf.length - 600);
  if (w.stats.msgs % 25 === 0) knowEmit();
}
// every 4 minutes: analyze what each watched live did, update the knowledge base
async function deptAnalyzeOne(w) {
    const batch = w.buf.splice(0);
    // gift spikes: which chat moments preceded a jump in diamonds
    const lines = batch.map(x => `${new Date(x.t).toISOString().slice(11, 19)} [${x.k}] ${x.name ? x.name + ': ' : ''}${x.text || ''}`).join('\n');
    try {
      const r = await brain([{ text: `You are the ANALYSIS DEPARTMENT building CHINO, a Hebrew/English TikTok LIVE host character (crowned lion king from Tel Aviv, charismatic, funny, confident, loves girls, never cruel/sexual/hateful). You study REAL live-stream event logs of successful BATTLE streamers. PRIORITY: the battles (two players facing off) — what the host does when a battle starts, when he's losing, when he's winning, how he rallies gifts, how he talks to the opponent. Between-battle filler matters less.
Log from streamer "${w.user}" (chat messages, gifts with diamond value, follows, battle events):
${lines}
Extract, in JSON:
"insights": up to 4 one-sentence findings (English) about what drove engagement/gifts/battle wins here (e.g. "gifts spike right after the host calls viewers by name").
"triggers": up to 4 rules for CHINO as {"when": "situation in English", "do": "what Chino should do, English", "say_he": "a Hebrew line (<=12 words) Chino can say", "say_en": "English version"}.
"lines": up to 8 NEW short lines Chino could say in moments seen here, each {"he": "...", "en": "...", "kind": "greeting|gift|hype|battle|comeback|question|joke"} — in CHINO's voice, not copied.
"hooks": up to 3 recurring chat phrases/memes from the audience (verbatim) that Chino should recognize and play with.
Return JSON only: {"insights":[...],"triggers":[...],"lines":[...],"hooks":[...]}` }]);
      const K = knowledge; const ts = Date.now(); const src = w.user;
      const st = K.streamers[src] || (K.streamers[src] = { first: ts, sessions: 0, msgs: 0, diamonds: 0 });
      st.sessions++; st.msgs += batch.length; st.diamonds = w.stats.diamonds; st.last = ts;
      for (const x of (r.insights || [])) K.insights.push({ t: ts, src, text: String(x) });
      for (const x of (r.triggers || [])) if (x && x.when) K.triggers.push({ t: ts, src, ...x });
      for (const x of (r.lines || [])) if (x && x.he && !K.lines.some(y => norm(y.he) === norm(x.he))) K.lines.push({ t: ts, src, ...x });
      for (const x of (r.hooks || [])) if (x && !K.hooks.some(y => y.text === x)) K.hooks.push({ t: ts, src, text: String(x) });
      for (const k of ['insights', 'triggers', 'hooks']) if (K[k].length > 120) K[k].splice(0, K[k].length - 120);
      if (K.lines.length > 600) K.lines.splice(0, K.lines.length - 600);
      K.updated = ts; saveJ('knowledge.json', K); knowEmit();
      emit('status', { msg: `🔬 מחלקת ניתוח: נלמדו ${(r.lines || []).length} משפטים ו-${(r.triggers || []).length} טריגרים מ-${src}` });
    } catch (e) { console.log('[dept]', e.message); }
}
async function deptAnalyze(force = false) {
  for (const w of Object.values(watchers)) {
    const fav = (follow.favorites || []).includes(w.user);
    if (w.buf.length < (force ? 3 : fav ? 8 : 15)) continue;
    await deptAnalyzeOne(w);
  }
}
setInterval(() => deptAnalyze().catch(() => {}), 240000);
setInterval(() => { for (const u of (follow.favorites || [])) if (watchers[u] && watchers[u].buf.length >= 8) deptAnalyzeOne(watchers[u]).catch(() => {}); }, 120000);
function knowledgeDigest() {
  const K = knowledge; if (!K.insights.length && !K.lines.length) return '';
  return `\nANALYSIS DEPARTMENT (learned from ${Object.keys(K.streamers).length} real streamers):\nInsights:\n${K.insights.slice(-8).map(x => '- ' + x.text).join('\n')}\nTriggers (when -> do):\n${K.triggers.slice(-8).map(x => `- ${x.when} -> ${x.do} | "${x.say_he}"`).join('\n')}\nAudience hooks to recognize: ${K.hooks.slice(-8).map(x => x.text).join(' | ')}\nLearned lines (he/en):\n${K.lines.slice(-30).map(x => `[${x.kind}] ${x.he} / ${x.en}`).join('\n')}\n`;
}

// ======================================================================
// AUTONOMOUS LIVE: Chino hosts alone. He fills silence, hypes, greets, reacts — you drop in when you want.
// ======================================================================
let auto = { ...{ on: false, quietAfterMs: 45000, lang: 'he' }, ...loadJ('autolive.json', {}) };
let lastLionSpokeAt = 0, autoTimer = null;
function autoEmit() { emit('autolive', { on: auto.on, lang: auto.lang, phase: show.phase, playbook: !!playbook.compiled }); }

// ---------- PLAYBOOK: everything learned (speech↔chat interactions, styles, battle tactics, department insights, music, body language)
// compiled every 10 minutes into ONE structured "how to run a battle live" model that the director executes ----------
let playbook = loadJ('playbook.json', { compiled: 0, phases: {}, cadence: { name_shoutout_s: 45, cta_s: 90, hype_s: 25 }, rituals: [], ctas: [], material: 0 });
const PHASES = ['opening', 'warmup', 'battle_start', 'battle_losing', 'battle_winning', 'battle_last_30s', 'battle_won', 'battle_lost', 'gift', 'lull'];
function materialCount() { const L = study.lessons; return L.lines.length + L.styles.length + (L.interactions || []).length + knowledge.insights.length + knowledge.triggers.length + (moves.chino || []).length; }
async function compilePlaybook(force = false) {
  const m = materialCount(); if (!force && (m < 12 || m === playbook.material)) return playbook;
  const L = study.lessons;
  const ix = (L.interactions || []).slice(-60).map(x => `- said "${x.said}" → to ${x.to}${x.name ? ' (' + x.name + ')' : ''} → ${x.reaction} [${x.result}]`).join('\n');
  const r = await brain([{ text: `${persona.text}
You are the HEAD COACH compiling a PLAYBOOK for CHINO (a crowned lion king, TikTok LIVE battle host, Tel Aviv, rich, loves girls, funny, confident, never cruel/sexual/hateful). Below is everything we learned from watching top real battle streamers: what they SAID, to WHOM (by name or to the room), how the CHAT reacted and what it produced (gifts/likes), their styles, battle tactics, the analysis department's insights and triggers, the music they play, and how they MOVE.
Compile ONE practical playbook CHINO will execute autonomously. For EVERY phase give: "goal" (one sentence), "moves" (3-6 concrete things to do, English), "lines": 6-10 short punchy lines CHINO would say in that phase, each as {"he":"Hebrew (max 12 words, street Israeli, first person)","en":"English (max 12 words, confident, native)"} — rewritten in CHINO's own voice, not copied. Use {שם}/{name} as a slot where a person's name goes (chat person or opponent).
Phases: ${PHASES.join(', ')} (battle_start = the moment a battle begins; battle_losing/winning = during the battle by score; battle_last_30s = final seconds, all-in push; battle_won/lost = right after; gift = a gift just arrived (thank by name, make the gifter a hero/MVP); lull = nobody talks, no battle; opening = first minutes of the live; warmup = building the room before a battle).
Also: "cadence": {"name_shoutout_s": seconds between saying a viewer's name, "cta_s": seconds between calls-to-action (tap/share/comment/follow), "hype_s": seconds between hype lines during a battle} — numbers learned from the pros; "rituals": 4-8 recurring rituals the pros do (English, one sentence each, e.g. crowning the top gifter MVP at the end of a battle); "ctas": 6-10 signature call-to-action phrases (short, in both languages: {"he","en"}); "personality_notes": 3 sentences on how CHINO should feel on air (energy, rhythm, humor) based on what works.
LEARNED INTERACTIONS (speech ↔ chat):
${ix || '(none yet)'}
STYLES: ${JSON.stringify(L.styles.slice(-15).map(x => x.text))}
BATTLE TACTICS: ${JSON.stringify(L.battle.slice(-15).map(x => x.text))}
CHAT PATTERNS: ${JSON.stringify(L.chat.slice(-10).map(x => x.text))}
LEARNED LINES: ${JSON.stringify(L.lines.slice(-60).map(x => `[${x.kind}/${x.when}] ${x.text}`))}
DEPARTMENT INSIGHTS: ${JSON.stringify(knowledge.insights.slice(-15).map(x => x.text))}
DEPARTMENT TRIGGERS: ${JSON.stringify(knowledge.triggers.slice(-15))}
HOW THEY MOVE (for Chino): ${JSON.stringify((moves.chino || []).slice(-10).map(x => x.text))}
${musicDigest()}
Return JSON: {"phases":{"opening":{"goal":"...","moves":[...],"lines":[{"he":"...","en":"..."}]}, ...all phases...}, "cadence":{"name_shoutout_s":45,"cta_s":90,"hype_s":25}, "rituals":[...], "ctas":[{"he":"...","en":"..."}], "personality_notes":"..."}` }]);
  if (r && r.phases) {
    playbook = { compiled: Date.now(), material: m, phases: r.phases, cadence: { ...playbook.cadence, ...(r.cadence || {}) }, rituals: r.rituals || [], ctas: r.ctas || [], notes: r.personality_notes || '' };
    saveJ('playbook.json', playbook); emit('playbook', playbookSummary()); emit('status', { msg: `📘 ספר המשחק עודכן (${Object.keys(r.phases).length} שלבים, ${m} פריטי ידע)` }); learnLog('insight', `📘 ספר המשחק של צ׳ינו עודכן מתוך ${m} פריטי ידע`);
  }
  return playbook;
}
function playbookSummary() { const ph = {}; for (const [k, v] of Object.entries(playbook.phases || {})) ph[k] = { goal: v.goal, n: (v.lines || []).length, ready: (v.lines || []).filter(l => bank.some(b => norm(b.text) === norm(fillName(auto.lang === 'en' ? l.en : l.he)))).length }; return { compiled: playbook.compiled, material: playbook.material, phases: ph, cadence: playbook.cadence, rituals: playbook.rituals, ctas: playbook.ctas, notes: playbook.notes }; }
setInterval(() => compilePlaybook().catch(e => console.log('[playbook]', e.message)), 600000);
setTimeout(() => compilePlaybook().catch(() => {}), 90000);
// pre-generate the playbook's lines (so the autonomous live plays them instantly) — respects the job queue
async function warmPlaybook(n = 12) {
  let made = 0; const want = [];
  for (const k of ['gift', 'battle_start', 'battle_losing', 'battle_winning', 'battle_last_30s', 'battle_won', 'battle_lost', 'lull', 'warmup', 'opening']) for (const l of ((playbook.phases[k] || {}).lines || []).slice(0, 3)) { const t = auto.lang === 'en' ? l.en : l.he; if (t) want.push(t); }
  for (const t of want) { if (made >= n) break; if (hasSlot(t)) { noteTemplate(t); continue; } if (!bankHit(t, false)) { made++; generateLine(t, { line: t }, { play: false }).catch(() => {}); } }
  return made;
}

// ---------- OUR live's battle state, read from TikTok (same source as the study) ----------
let ourBattle = null, ourOwnerId = '', ourBattleId = '', ourLead = '';
async function pollOurBattle() {
  if (!tt.on || !tt.roomId) { ourBattle = null; return; }
  try {
    const { raw, d } = await roomInfoRaw(tt.roomId);
    if (!ourOwnerId) ourOwnerId = String(d.owner?.id_str || (raw.match(/"owner":\{[^{}]*?"id_str":"(\d+)"/) || [])[1] || '');
    const rival = (raw.match(/"rival_anchor_id":"?(\d{6,})"?/) || [])[1] || '';
    const bid = (raw.match(/"battle_id":"?(\d{6,})"?/) || [])[1] || '';
    const finished = (raw.match(/"finished":(\d)/) || [])[1] === '1';
    const start = +((raw.match(/"start_time":(\d+)/) || [])[1] || 0), dur = +((raw.match(/"duration":(\d+)/) || [])[1] || 0);
    const scores = [...raw.matchAll(/\{"score":(\d+),"user_id":"?(\d{6,})"?\}/g)].map(m => ({ score: +m[1], id: m[2] }));
    const mine = scores.find(x => x.id === ourOwnerId)?.score ?? 0, theirs = scores.find(x => x.id !== ourOwnerId)?.score ?? 0;
    const left = start && dur ? Math.max(0, Math.round(start + dur - Date.now() / 1000)) : 0;
    const inBattle = !!rival && !finished && (left > 0 || scores.length);
    const prev = ourBattle;
    ourBattle = inBattle ? { id: bid, mine, theirs, left, dur, since: prev?.id === bid ? prev.since : Date.now() } : null;
    if (inBattle && bid !== ourBattleId) { ourBattleId = bid; show.event = 'battle_start'; show.eventAt = Date.now(); emit('status', { msg: `⚔️ קרב התחיל בלייב שלנו${opp.name ? ' מול ' + opp.name : ''}` });
      rivalHandleOf(rival).then(h => { if (h && !opp.auto_locked && opp.handle !== h) { opp = { ...opp, handle: h, name: opp.name || h, detected: Date.now() }; saveJ('opponent.json', opp); emit('opponent', opp); emit('status', { msg: `🥊 היריב בקרב: ${h} — לחץ "זהה וייצר" (או השאר ריק, הוא כבר מזוהה)` }); } }); }
    if (!inBattle && prev) { show.event = prev.mine > prev.theirs ? 'battle_won' : 'battle_lost'; show.eventAt = Date.now(); show.lastResult = prev; emit('status', { msg: `🏁 הקרב נגמר — ${prev.mine > prev.theirs ? 'ניצחנו' : 'הפסדנו'} ${prev.mine} מול ${prev.theirs}` }); }
  } catch (e) { console.log('[our battle]', e.message); }
}
setInterval(() => pollOurBattle().catch(() => {}), 15000);
// our own live: connect at boot and keep trying while we're off-air (the socket reconnects by itself once we're on)
setTimeout(() => { if (settings.tiktokUser && settings.tiktoolsKey && !tt.on) ttConnect(settings.tiktokUser).catch(e => console.log('[tt auto]', e.message)); }, 4000);
setInterval(() => { if (settings.tiktokUser && settings.tiktoolsKey && !tt.on) ttConnect(settings.tiktokUser).catch(() => {}); }, 60000);

// ---------- SHOW DIRECTOR: decides the PHASE of our live and what a pro host does in it ----------
let show = { phase: 'lull', event: '', eventAt: 0, lastNameAt: 0, lastCtaAt: 0, lastHypeAt: 0, lastResult: null, startedAt: 0 };
let recentGifters = [];   // [{name, gift, dia, t}]
function phaseNow() {
  const now = Date.now();
  if (show.event && now - show.eventAt < 25000) return show.event;                      // battle_start / battle_won / battle_lost just happened
  if (ourBattle) { if (ourBattle.left > 0 && ourBattle.left <= 30) return 'battle_last_30s'; return ourBattle.mine >= ourBattle.theirs ? 'battle_winning' : 'battle_losing'; }
  if (show.startedAt && now - show.startedAt < 180000) return 'opening';
  if (recentGifters.length && now - recentGifters[recentGifters.length - 1].t < 20000) return 'gift';
  const recentChat = convo.slice(-6).filter(x => x.who === 'chat' && now - (x.t || 0) < 60000).length;
  return recentChat >= 2 ? 'warmup' : 'lull';
}
async function autoHostTick() {
  if (!auto.on || deskMuted || (clipPlaying && clipPlaying.audio)) return;
  if (training.on) return;   // in LEARNING mode the training brain talks about what he learns — no random filler
  const now = Date.now(); const phase = phaseNow();
  if (phase !== show.phase) { show.phase = phase; autoEmit(); }
  const idleFor = now - Math.max(lastLionSpokeAt, lastAutoAt, lastReplyAt);
  // pros never let a battle go quiet: during battles the gap is the learned hype cadence, otherwise the lull setting
  const gap = /^battle_/.test(phase) ? (playbook.cadence.hype_s || 25) * 1000 : phase === 'opening' || phase === 'warmup' ? Math.min(auto.quietAfterMs, 30000) : auto.quietAfterMs;
  if (idleFor < gap || brainBusy || opponentBusy) return;
  brainBusy = true;
  try {
    const recent = convo.slice(-12).map(x => (x.who === 'ariel' ? 'CHINO' : x.who === 'opponent' ? 'OPPONENT' : 'CHAT') + ': ' + x.text).join('\n');
    const known = bank.slice().sort((a, b) => b.count - a.count).slice(0, 60).map(b => b.text);
    const pb = playbook.phases[phase] || playbook.phases[phase.replace(/_.*/, '')] || {};
    const lang = auto.lang === 'en' ? 'en' : 'he';
    const pbLines = (pb.lines || []).map(l => l[lang]).filter(Boolean);
    const names = [...new Set(convo.slice(-20).filter(x => x.who === 'chat').map(x => (x.text.match(/^([^:]{2,30}):/) || [])[1]).filter(Boolean))].slice(-8);
    const topGifter = recentGifters.slice().sort((a, b) => b.dia - a.dia)[0];
    const wantName = now - show.lastNameAt > (playbook.cadence.name_shoutout_s || 45) * 1000 && names.length;
    const wantCta = now - show.lastCtaAt > (playbook.cadence.cta_s || 90) * 1000;
    const sp = spotify.playing ? `A song is playing: ${spotify.title}.` : 'No music right now.';
    const battle = ourBattle ? `BATTLE: we have ${ourBattle.mine} vs ${ourBattle.theirs} (${ourBattle.mine >= ourBattle.theirs ? 'winning' : 'LOSING'}), ${ourBattle.left}s left${opp.name ? ', opponent: ' + opp.name : ''}.` : show.lastResult && phase.startsWith('battle_') ? `The battle just ended ${show.lastResult.mine} vs ${show.lastResult.theirs}.` : '';
    const r = await brain([{ text: `${persona.text}
${knowledgeDigest()}${lessonsDigest()}${namesDigest()}${musicDigest()}
${playbook.notes ? 'HOW CHINO FEELS ON AIR: ' + playbook.notes : ''}
You are CHINO running your own TikTok LIVE like the top battle hosts you studied. Current PHASE: ${phase.toUpperCase()}. ${pb.goal ? 'Goal of this phase: ' + pb.goal : ''}
${pb.moves?.length ? 'What pros do now:\n- ' + pb.moves.join('\n- ') : ''}
${battle} ${sp} Nobody has spoken for ${Math.round(idleFor / 1000)}s.
${wantName ? `It is time to say a viewer's NAME (pros do it every ~${playbook.cadence.name_shoutout_s}s). Names in the room: ${names.join(', ')}.` : ''}
${wantCta ? `It is time for a CALL TO ACTION (tap / share / comment / follow) — pros do one every ~${playbook.cadence.cta_s}s. Signature CTAs: ${JSON.stringify((playbook.ctas || []).map(c => c[lang]).filter(Boolean).slice(0, 8))}` : 'Do NOT do a call-to-action now (too soon).'}
${topGifter && phase === 'gift' ? `A gift just came from ${topGifter.name} (${topGifter.gift}, ${topGifter.dia} diamonds) — make them the hero.` : ''}
Say ONE line (max 12 words, first person, ${lang === 'en' ? 'English, confident and native' : 'Hebrew, street Israeli'}). Vary — never repeat the last few lines. Never cruel/sexual/hateful.
PRIORITY: 1) a READY line that fits (copy EXACTLY — it plays instantly), 2) a PLAYBOOK line for this phase (copy EXACTLY), 3) a new line in the same spirit.
Recent:
${recent}
PLAYBOOK lines for ${phase}: ${JSON.stringify(pbLines.slice(0, 10))}
READY: ${JSON.stringify(known)}
Return JSON: {"line":"...", "emotion":"one English word", "face":"short English description", "said_name": true/false, "cta": true/false}` }]);
    if (r && r.line) { lastAutoAt = Date.now(); if (r.said_name) show.lastNameAt = Date.now(); if (r.cta) show.lastCtaAt = Date.now(); show.lastHypeAt = Date.now(); await autoSay(r.line, { emotion: r.emotion, face: r.face }); }
  } catch (e) { emit('status', { msg: 'מנחה אוטומטי: ' + e.message }); }
  brainBusy = false;
}
setInterval(() => autoHostTick().catch(() => {}), 5000);


// ---------- name templates: {שם} is replaced by the current opponent's name ----------
let opp = { ...{ name: '', handle: '' }, ...loadJ('opponent.json', {}) };
const fillName = text => String(text || '').replace(/\{שם\}|\{name\}/g, opp.name || 'אחי');
function hasSlot(text) { return /\{שם\}|\{name\}/.test(String(text || '')); }
// a template line is remembered as a template; the actual clip is cached per (template, name)
let templates = loadJ('templates.json', []);     // [{text, count}]
function noteTemplate(text) { if (!hasSlot(text)) return; const n = norm(text); let t = templates.find(x => norm(x.text) === n); if (!t) { t = { text, count: 0 }; templates.push(t); } t.count++; saveJ('templates.json', templates); }


// ======================================================================
// ALWAYS-ON LEARNING: favorite streamers are watched whenever they are live;
// the department also hunts for the strongest BATTLE streamers and learns from them continuously.
// ======================================================================
let follow = { ...{ favorites: ['prettyboyali24'], freeLearn: true, battlesOnly: true, maxWatch: 6, region: '' }, ...loadJ('follow.json', {}) };
const hunted = {};   // uniqueId -> { battles, seenAt, score }
async function isLiveNow(user) {
  // cheap probe: a 1-minute JWT + open/close a socket is heavy; instead rely on top-channels + watcher roomInfo. Treat "not in top list" as unknown -> try to connect anyway (cheap, auto-reconnect handles offline).
  return true;
}
async function followTick() {
  if (!settings.tiktoolsKey) return;
  // 1) favorites: always watched (watcher auto-reconnects; offline streamers just stay "נותק")
  for (const u of (follow.favorites || [])) if (!watchers[u]) watchStart(u);
  // 2) free learning: pull hot channels and watch the strongest battle streamers
  if (!follow.freeLearn) return;
  try {
    const top = await (await fetch('https://api.tik.tools/api/live/top-channels')).json();
    let list = (top.channels || []).filter(c => c.uniqueId);
    if (follow.region) list = list.filter(c => String(c.region || '').toUpperCase().startsWith(follow.region.toUpperCase()));
    list.sort((a, b) => (b.viewerCount || 0) - (a.viewerCount || 0));
    const room = Math.max(0, (follow.maxWatch || 6) - Object.keys(watchers).length);
    for (const c of list.slice(0, Math.min(room, 4))) if (!watchers[c.uniqueId]) { watchStart(c.uniqueId); hunted[c.uniqueId] = { seenAt: Date.now(), battles: 0, score: c.viewerCount || 0 }; }
  } catch (e) { console.log('[hunt]', e.message); }
  // 3) battles-only: after 6 minutes, drop hunted channels that showed no battle (keep favorites always)
  for (const [u, w] of Object.entries(watchers)) {
    if ((follow.favorites || []).includes(u)) continue;
    const age = Date.now() - w.since;
    if (follow.battlesOnly && age > 360000 && w.stats.battles === 0) { watchStop(u); emit('status', { msg: `🔬 ${u}: בלי קרבות — עוזבים, מחפשים אחר` }); }
  }
}
setInterval(() => followTick().catch(() => {}), 90000);
setTimeout(() => followTick().catch(() => {}), 8000);

const pending = new Map();   // proposals waiting for the operator's approval
function bankHit(text, play) {
  noteTemplate(text); text = fillName(text);
  if (play && set.mode === '3d') { if (engine.online) engineSay(text).catch(e => emit('status', { msg: 'מנוע: ' + e.message })); return { text, engine: true }; }
  const n = norm(text);
  const e = bank.find(b => b.norm === n || norm(b.text) === n);
  if (e && fs.existsSync(P('media', 'bank', e.file))) {
    e.count++; e.last = Date.now(); saveJ('bank.json', bank);
    if (play) emit('play', { file: '/media/bank/' + e.file, text: e.text, kind: 'talk' });
    emit('bank', {}); return e;
  }
  return null;
}
// step 1: operator line -> bank hit (instant) OR a proposal to approve
async function say(text, { play = true, res = '720p', rewrite = true } = {}) {
  text = String(text || '').trim(); if (!norm(text)) throw new Error('empty');
  noteTemplate(text); text = fillName(text);
  if (set.mode === 'off') throw new Error('מצב בלי אריה — אין מי שידבר. החלף מצב למעלה');
  if (set.mode === '3d') { if (!engine.online) throw new Error('מצב 3D: המנוע של Codex לא מחובר'); await engineSay(text, { source: 'operator' }); return { engine: true }; }
  if (bankHit(text, play)) return { cached: true };
  let d = { line: text, names: [], emotion: 'confident', face: '' };
  if (rewrite) { emit('status', { msg: `🧠 מעבד: "${text}"` }); try { d = await toLion(text); } catch (err) { emit('status', { msg: 'עיבוד נכשל: ' + err.message }); } }
  const pid = crypto.randomBytes(4).toString('hex');
  pending.set(pid, { input: text, ...d, res, play });
  emit('proposal', { pid, input: text, line: d.line, names: d.names, emotion: d.emotion });
  return { proposal: pid };
}
// step 2: operator approved (maybe edited) -> generate video
async function generateLine(input, d, { play = true, res = '720p', force = false } = {}) {
  if (set.mode === '3d' && !force) throw new Error('מצב 3D: לא מייצרים וידאו של האריה (Codex מדבר)');
  input = fillName(input); d = { ...d, line: fillName(d.line) };
  if (!d.move && /hype|battle|comeback|excited|angry|proud|laugh|celebrat/i.test(String(d.emotion || '') + String(d.kind || ''))) d.move = moveStyle('battle');
  const n = norm(input);
  if (jobs.has(n)) return jobs.get(n);
  const p = (async () => {
    emit('status', { msg: `🦁 מייצר וידאו: "${d.line}"` });
    const id = crypto.randomBytes(5).toString('hex'), file = id + '.mp4';
    const g = await generateChecked(talkPrompt(d.line, d), P('media', 'bank', file), d.line, res, `"${d.line}"`);
    emit('status', { msg: `🧼 מנקה את הקול: "${d.line}"` }); const clean = await cleanVoice(P('media', 'bank', file));
    const e = { id, text: d.line, input, norm: n, file, count: 1, created: Date.now(), last: Date.now(), secs: g.secs, res, score: g.score, defects: g.defects, emotion: d.emotion, clean };
    bank.push(e); saveJ('bank.json', bank);
    if (play && (settings.autoPlayNew || convoSettings.autoReply)) emit('play', { file: '/media/bank/' + file, text: e.text, kind: 'talk' });
    else emit('ready', { id: e.id, text: e.text, score: g.score });
    emit('bank', {}); emit('status', { msg: `מוכן (${g.secs} שנ׳, ⭐${g.score}): "${e.text}"` + (settings.autoPlayNew ? '' : ' — נשמר, לחץ ▶ כדי לשדר') });
    return e;
  })();
  jobs.set(n, p); p.finally(() => jobs.delete(n));
  return p;
}

async function addIdle(extra) {
  const file = 'idle_' + Date.now() + '.mp4';
  emit('status', { msg: 'מייצר איידל חדש…' });
  const { secs } = await generateChecked(idlePrompt(extra), P('media', 'idle', file), null, '720p', 'איידל');
  emit('idles', {}); emit('status', { msg: `איידל חדש מוכן (${secs} שנ׳)` });
  return file;
}

const singPrompt = (a, i) => `${LOOK} The CHORUS of a ${a.genre || 'pop'} song at ${a.bpm || 100} BPM hits and he goes OFF while seated on the throne: ${[
  'he pumps both paws in the air on every beat, head bouncing hard, mouth open shouting the chorus along, chains swinging, crown bouncing',
  'he stands up halfway off the throne, points at the camera, drops back down on the beat, grinning wide and singing the chorus with big mouth movements',
  'dramatic slow-motion head whip then rapid shoulder pops on the beat, arms spread wide like a king on stage, singing full voice',
][i % 3]}. Big, energetic, funny, clearly dancing and singing — NOT subtle. He stays exactly the same lion in every frame, paws clean, no warping. The video itself is SILENT (no voice, no music). Starts and ends on the exact same pose as the image. No camera motion, no cuts, no text.`;
const vibePrompt = (a, i) => `${LOOK} Music is playing in the room and he vibes to it while staying seated on the throne, relaxed and cool: ${['gentle head nods on the beat, shoulders softly swaying', 'a slow groove, small nod, a confident smirk, a light tap of the claws on the armrest to the rhythm'][i % 2]}, at about ${a.bpm || 100} BPM, ${a.genre || ''} feel. Mouth closed. He stays exactly the same lion in every frame. Starts and ends on the exact same pose as the image. No camera motion, no cuts, no text. Silent.`;
async function learnSong(name, buf, mime) {
  const id = crypto.randomBytes(5).toString('hex');
  const ext = (name.match(/\.\w+$/) || ['.mp3'])[0];
  const file = id + ext; fs.writeFileSync(P('media', 'songs', file), buf);
  const song = { id, name: name.replace(/\.\w+$/, ''), file, analysis: null, dances: [], sings: [], chorus: [], created: Date.now(), status: 'מקשיב לשיר…' };
  songs.push(song); saveJ('songs.json', songs); emit('songs', {});
  try {
    emit('status', { msg: `🎵 מקשיב ולומד: "${song.name}"…` });
    song.analysis = await brain([
      { inline_data: { mime_type: mime || 'audio/mpeg', data: buf.toString('base64') } },
      { text: 'Listen to this whole song. Do NOT write any lyrics. Return JSON: {"genre": string, "bpm": number, "mood": string, "energy": "low|mid|high", "duration_sec": number, "chorus": [[start_sec, end_sec], ...] (every time the chorus/hook section plays, in seconds from the start of the file, as accurate as possible), "summary_he": "one short Hebrew sentence about the vibe of the song"}' },
    ]);
    song.chorus = (song.analysis.chorus || []).filter(c => Array.isArray(c) && c.length === 2).map(c => [+c[0], +c[1]]);
    song.status = `שומע ${song.chorus.length} פזמונים — מייצר קליפים…`; saveJ('songs.json', songs); emit('songs', {});
    const mk = (kind, promptFn, i) => (async () => { const f = `${id}_${kind}${i + 1}.mp4`; await generateChecked(promptFn(song.analysis, i), P('media', 'dance', f), null, '720p', kind === 'sing' ? 'שירה' : 'וייב'); return [kind, f]; })();
    const outs = await Promise.allSettled([mk('vibe', vibePrompt, 0), mk('vibe', vibePrompt, 1), mk('sing', singPrompt, 0), mk('sing', singPrompt, 1), mk('sing', singPrompt, 2)]);
    for (const o of outs) if (o.status === 'fulfilled') (o.value[0] === 'sing' ? song.sings : song.dances).push(o.value[1]);
    song.status = song.dances.length ? 'למד ✓' : 'נכשל: ' + (outs[0].reason?.message || '');
  } catch (e) { song.status = 'נכשל: ' + e.message; }
  saveJ('songs.json', songs); emit('songs', {}); emit('status', { msg: `שיר "${song.name}": ${song.status}` });
}
const songPayload = s => ({ id: s.id, name: s.name, audio: '/media/songs/' + s.file, dances: (s.dances || []).map(f => '/media/dance/' + f), sings: (s.sings || []).map(f => '/media/dance/' + f), chorus: s.chorus || [] });
let playlistOn = false;

// ---------- Spotify: detect the playing song, learn it automatically, dance while it plays ----------
let settings = { autoDance: true, autoLearn: false, learnPlaylist: false, autoPlayNew: false, ...loadJ('settings.json', {}) };
let spotify = { title: '', playing: false, since: 0, pausedAt: 0 };
const PY = ['py', ['-3.13']];
const runPy = (args, cb) => execFile(PY[0], [...PY[1], ...args], { windowsHide: true }, cb || (() => {}));
const songByName = name => songs.find(x => norm(x.name) === norm(name));
async function learnSongByName(name) {
  if (songByName(name)) return;
  const id = crypto.randomBytes(5).toString('hex');
  const song = { id, name, source: 'spotify', analysis: null, dances: [], created: Date.now(), status: 'לומד…' };
  songs.push(song); saveJ('songs.json', songs); emit('songs', {});
  try {
    emit('status', { msg: `🎵 לומד מספוטיפיי: ${name}` });
    song.analysis = await brain([{ text: `The song "${name}" (Spotify window title, format "Artist - Title"). Based on what you know about it (or its artist/genre if unsure), return JSON: {"genre": string, "bpm": number, "mood": string, "energy": "low|mid|high", "dance": "one English sentence describing how a lion king seated on a throne should dance to it (head, shoulders, paws)", "summary_he": "one short Hebrew sentence about the song"}` }]);
    song.status = 'מייצר ריקודים…'; saveJ('songs.json', songs); emit('songs', {});
    const outs = await Promise.allSettled([0, 1, 2].map(async i => { const f = `${id}_dance${i + 1}.mp4`; await generateChecked(dancePrompt(song.analysis, i), P('media', 'dance', f), null, '720p', 'ריקוד'); return f; }));
    song.dances = outs.filter(o => o.status === 'fulfilled').map(o => o.value);
    song.status = song.dances.length ? 'למד ✓' : 'נכשל';
  } catch (e) { song.status = 'נכשל: ' + e.message; }
  saveJ('songs.json', songs); emit('songs', {}); emitSpotify();
}

// ---------- learn the song playing in Spotify: record the computer sound, find chorus, make clips ----------
let rec = null;
function startRec() {
  if (rec) return { error: 'כבר מקליט' };
  if (!spotify.playing) return { error: 'ספוטיפיי לא מנגן' };
  const id = crypto.randomBytes(5).toString('hex');
  rec = { id, title: spotify.title, wav: P('media', 'songs', id + '.wav'), stop: P('data', id + '.stop'), start: Date.now(), offset: (Date.now() - spotify.since) / 1000 };
  const r = rec;
  runPy([P('tools', 'rec.py'), r.wav, r.stop, '420'], () => finishRec(r));
  emit('status', { msg: `🎧 מקשיב לשיר "${r.title}" — תן לו להתנגן עד הסוף` }); emitSpotify();
  return { ok: true };
}
function stopRec() { if (rec) { try { fs.writeFileSync(rec.stop, '1'); } catch {} rec = null; emitSpotify(); } }
async function finishRec(r) {
  if (rec === r) rec = null; emitSpotify();
  try { fs.unlinkSync(r.stop); } catch {}
  const secs = (Date.now() - r.start) / 1000;
  if (!fs.existsSync(r.wav) || secs < 25) { emit('status', { msg: r.title + ': ההקלטה קצרה מדי — לא נלמד' }); return; }
  let song = songByName(r.title);
  if (!song) { song = { id: r.id, name: r.title, source: 'spotify', dances: [], sings: [], chorus: [], created: Date.now() }; songs.push(song); }
  song.status = 'מנתח…'; saveJ('songs.json', songs); emit('songs', {});
  try {
    const a = await brain([
      { inline_data: { mime_type: 'audio/wav', data: fs.readFileSync(r.wav).toString('base64') } },
      { text: `This is a recording of the song "${r.title}" (it may start in the middle of the song). Do NOT write any lyrics. Return JSON: {"genre": string, "bpm": number, "mood": string, "energy": "low|mid|high", "chorus": [[start_sec, end_sec], ...] (every time the chorus/hook plays, in seconds from the start of THIS recording), "summary_he": "one short Hebrew sentence about the vibe"}` },
    ]);
    song.analysis = a;
    song.chorus = (a.chorus || []).filter(c => Array.isArray(c) && c.length === 2).map(c => [+c[0] + r.offset, +c[1] + r.offset]);
    song.status = `שומע ${song.chorus.length} פזמונים — מייצר קליפים…`; saveJ('songs.json', songs); emit('songs', {});
    const mk = (kind, fn, i) => (async () => { const f = `${song.id}_${kind}${i + 1}.mp4`; await generateChecked(fn(a, i), P('media', 'dance', f), null, '720p', kind === 'sing' ? 'שירה' : 'וייב'); return [kind, f]; })();
    const outs = await Promise.allSettled([mk('vibe', vibePrompt, 0), mk('vibe', vibePrompt, 1), mk('sing', singPrompt, 0), mk('sing', singPrompt, 1), mk('sing', singPrompt, 2)]);
    song.dances = []; song.sings = [];
    for (const o of outs) if (o.status === 'fulfilled') (o.value[0] === 'sing' ? song.sings : song.dances).push(o.value[1]);
    song.status = song.dances.length ? 'למד ✓' : 'נכשל';
  } catch (e) { song.status = 'נכשל: ' + e.message; }
  saveJ('songs.json', songs); emit('songs', {}); emitSpotify(); emit('status', { msg: `🎵 "${song.name}": ${song.status}` });
}
let duckLevel = 1, spVol = 1;
function duck(on) { const lvl = on ? Math.round(spVol * 0.55 * 100) / 100 : spVol; if (lvl === duckLevel) return; duckLevel = lvl; if (process.platform === 'win32') runPy([P('tools', 'duck.py'), String(lvl)]); }


// ---------- Spotify account (Web API, PKCE login on this computer) ----------
const SP_REDIRECT = 'http://127.0.0.1:7777/spotify/callback';
const SP_SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public';
let spTok = loadJ('spotify_token.json', null), spVerifier = null;
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function spToken(body) {
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error_description || j.error || 'token error');
  spTok = { ...spTok, ...j, expires_at: Date.now() + (j.expires_in - 60) * 1000 }; saveJ('spotify_token.json', spTok); return spTok;
}
async function spApi(method, pth, body) {
  if (!spTok) throw new Error('ספוטיפיי לא מחובר');
  if (Date.now() > spTok.expires_at) await spToken({ grant_type: 'refresh_token', refresh_token: spTok.refresh_token, client_id: settings.spotifyClientId });
  const r = await fetch('https://api.spotify.com/v1' + pth, { method, headers: { Authorization: 'Bearer ' + spTok.access_token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return null;
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j?.error?.message || ('Spotify ' + r.status));
  return j;
}
async function spTrackUri(title, artist, known) {
  if (known && /^spotify:track:/.test(known)) return known;
  const j = await spApi('GET', `/search?type=track&limit=1&q=${encodeURIComponent(`track:${title} artist:${artist}`)}`);
  const t = j?.tracks?.items?.[0]; if (!t) { const j2 = await spApi('GET', `/search?type=track&limit=1&q=${encodeURIComponent(title + ' ' + artist)}`); const t2 = j2?.tracks?.items?.[0]; if (!t2) throw new Error('לא נמצא בספוטיפיי: ' + title); return t2.uri; }
  return t.uri;
}
// exact position from the API (better chorus timing than the window title)
async function spSync() {
  if (!spTok || !settings.spotifyClientId) return false;
  try {
    const j = await spApi('GET', '/me/player/currently-playing');
    if (!j || !j.item) return true;
    const title = `${(j.item.artists || []).map(a => a.name).join(', ')} - ${j.item.name}`;
    const since = Date.now() - (j.progress_ms || 0);
    const changed = title !== spotify.title || !!j.is_playing !== spotify.playing || Math.abs(since - spotify.since) > 1500;
    if (rec && (title !== rec.title || !j.is_playing)) stopRec();
    spotify.title = title; spotify.playing = !!j.is_playing; spotify.since = since; spotify.pausedAt = 0;
    if (spotify.playing && settings.learnPlaylist && !rec) { const k = songByName(title); if (!k || !(k.chorus || []).length) startRec(); }
    if (changed) emitSpotify();
    return true;
  } catch { return false; }
}

function emitSpotify() {
  const s = spotify.playing ? songByName(spotify.title) : null;
  emit('spotify', { title: spotify.title, playing: spotify.playing, since: spotify.since, learnPlaylist: settings.learnPlaylist, learned: !!(s && s.dances.length), learning: !!rec, dances: settings.autoDance && s ? s.dances.map(f => '/v/dance/' + f) : [], sings: settings.autoDance && s ? (s.sings || []).map(f => '/v/dance/' + f) : [], chorus: s?.chorus || [] });
}
async function pollSpotify() {
  if (await spSync()) return;
  if (process.platform !== 'win32') return;
  execFile('powershell.exe', ['-NoProfile', '-Command', "[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-Process Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle"], { windowsHide: true, encoding: 'utf8' }, (err, out) => {
    const t = (out || '').trim();
    const playing = !!t && !/^spotify( premium| free)?$/i.test(t);
    const title = playing ? t : spotify.title;
    if (playing !== spotify.playing || title !== spotify.title) {
      const now = Date.now();
      if (playing && title === spotify.title && spotify.pausedAt) spotify.since += now - spotify.pausedAt;   // resumed same song
      else if (playing && title !== spotify.title) spotify.since = now;                                     // new song started
      spotify.pausedAt = playing ? 0 : now;
      if (rec && (title !== rec.title || !playing)) stopRec();
      spotify.title = title; spotify.playing = playing;
      if (playing && settings.learnPlaylist && !rec) { const k = songByName(title); if (!k || !(k.chorus || []).length) startRec(); }
      if (playing && settings.autoLearn) learnSongByName(title).catch(() => {});
      emitSpotify();
    }
  });
}
setInterval(pollSpotify, 4000);
if (process.platform === 'win32') { const pin = spawn('py', ['-3.13', P('tools', 'pin_chrome_vol.py')], { windowsHide: true, stdio: 'ignore' }); pin.unref(); }


// minimal ZIP (store, no compression) for downloading all clips
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function makeZip(files) {
  const parts = [], central = []; let off = 0; const used = new Set();
  for (const f of files) {
    let name = f.name; let i = 2; while (used.has(name)) name = f.name.replace(/\.mp4$/, ` (${i++}).mp4`); used.add(name);
    const data = fs.readFileSync(f.path), nb = Buffer.from(name, 'utf8'), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, nb, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10); c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(0, 30); c.writeUInt32LE(0, 34); c.writeUInt32LE(0, 38); c.writeUInt32LE(off, 42);
    central.push(c, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}


// ---------- "fun clips": opponent's face + the lion, as a stylized 3D cartoon scene ----------
const IMG_MODEL = 'gemini-3.1-flash-image';
let fun = loadJ('fun.json', []);
const SCENES = {
  baby:    { he: '🍼 תינוק בידיים של האריה', img: 'the lion holds the person, drawn as a cute chubby 3D cartoon baby in a white bonnet wrapped in a soft blanket, in his arms, smiling proudly like a father', move: 'the lion gently rocks the cartoon baby in his arms, the baby giggles and kicks its little legs, the lion smirks at the camera' },
  bow:     { he: '🙇 משתחווה למלך', img: 'the person, drawn as a small 3D cartoon character in a royal servant outfit, kneels on the step in front of the throne bowing to the lion, who looks down with a proud smirk', move: 'the cartoon servant bows again and again toward the lion, the lion nods slowly like a king accepting respect' },
  fan:     { he: '🪭 מנפנף למלך', img: 'the person, drawn as a 3D cartoon palace servant, stands next to the throne fanning the lion with a big golden palm-leaf fan', move: 'the cartoon servant fans the lion with big rhythmic strokes, the lion leans back enjoying it, mane blowing in the breeze' },
  tiny:    { he: '🤏 קטן על הכף של האריה', img: 'the person, drawn as a tiny 3D cartoon figure, sits on the lion\'s open paw at chest height while the lion looks at them amused', move: 'the tiny cartoon person waves and jumps on the lion\'s paw, the lion raises an eyebrow and laughs silently' },
  kuchi:   { he: '👶 קוצ׳י קוצ׳י על הברכיים', img: 'the person, drawn as a chubby 3D cartoon baby in a white bonnet and a diaper, sits on the lion\'s knees crying with big cartoon tears while the lion looks down at the baby amused', move: 'the cartoon baby cries on the lion\'s knees, the lion tickles its belly with one big paw (kuchi kuchi), the baby bursts into giggles and claps its little hands, the lion smirks proudly at the camera' },
};
async function genImage(parts) {
  const call = async cfg => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMG_MODEL}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: cfg }), signal: AbortSignal.timeout(180000) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || ('HTTP ' + r.status));
    const p = j.candidates?.[0]?.content?.parts?.find(x => x.inlineData || x.inline_data); const d = p && (p.inlineData || p.inline_data);
    if (!d) throw new Error('לא חזרה תמונה'); return { data: d.data, mime: d.mimeType || d.mime_type || 'image/png' };
  };
  try { return await call({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } }); }
  catch (e) { if (/imageConfig|aspect/i.test(e.message)) return await call({ responseModalities: ['IMAGE'] }); throw e; }
}
async function makeFun(snapFile, sceneKey, label, user = '') {
  const sc = SCENES[sceneKey]; if (!sc) throw new Error('scene?');
  const id = crypto.randomBytes(5).toString('hex');
  const item = { id, scene: sceneKey, sceneHe: sc.he, label: label || '', user: user || '', status: '🎨 יוצר תמונה…', created: Date.now() };
  fun.unshift(item); saveJ('fun.json', fun); emit('fun', { item });
  try {
    const face = fs.readFileSync(snapFile).toString('base64');
    const im = await genImage([
      { inline_data: { mime_type: 'image/png', data: master64() } },
      { inline_data: { mime_type: 'image/jpeg', data: face } },
      { text: `Image 1 is ARIEL: a crowned lion king seated on a golden throne in a dark striped room. Keep him exactly the same (same face, mane, crown, gold chains, red velvet throne, lighting). Image 2 is a photo of a person. Create ONE vertical 9:16 cinematic image in the same room and lighting as image 1, where ${sc.img}. Draw the person as a friendly stylized 3D animated-movie character (Pixar-like caricature), clearly recognizable from image 2 (same face shape, hair, skin tone, beard or glasses if any) but NOT photorealistic. Playful and funny, never humiliating, nothing sexual or violent. No text, no logos.` },
    ]);
    const ext = im.mime.includes('jpeg') ? 'jpg' : 'png';
    fs.writeFileSync(P('media', 'fun', id + '.' + ext), Buffer.from(im.data, 'base64'));
    item.img = '/media/fun/' + id + '.' + ext; item.status = '🎬 יוצר וידאו…'; saveJ('fun.json', fun); emit('fun', { item });
    await runJob(() => omni(`Animate this exact image. Locked-off static camera, same lion king, same room. ${sc.move}. The lion keeps his exact look. The cartoon character keeps the same look in every frame. Smooth, funny, 8 seconds. No dialogue, no text, light playful sound effects only.`, P('media', 'fun', id + '.mp4'), '720p', im));
    item.file = '/media/fun/' + id + '.mp4'; item.status = 'מוכן ✓';
    const ak = String(user || '').toLowerCase() + '|' + sceneKey; if (user && autoLaunch.has(ak)) { autoLaunch.delete(ak); emit('play', { file: item.file, text: item.sceneHe, kind: 'fun' }); emit('status', { msg: `🚀 שוגר ללייב: ${item.sceneHe} · ${user}` }); autoLaunchEmit(); }
  } catch (e) { item.status = 'נכשל: ' + e.message; }
  saveJ('fun.json', fun); emit('fun', { item });
}


// ---------- virtual camera ("OBS Virtual Camera" in Live Studio) ----------
let vcamProc = null;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
function openStageWindow(out = '') {
  spawn(CHROME, ['--user-data-dir=' + P('data', 'chrome_live'), `--app=http://localhost:7777/stage?live=1${out ? '&out=' + encodeURIComponent(out) : ''}`, '--window-size=600,1066',
    '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--no-first-run'], { detached: true, stdio: 'ignore' }).unref();
}
function vcam(on) {
  if (on && !vcamProc) {
    vcamProc = spawn('py', ['-3.13', '-u', P('tools', 'vcam.py')], { windowsHide: true });
    vcamProc.stdout.on('data', d => emit('status', { msg: '🎥 ' + String(d).trim() }));
    vcamProc.stderr.on('data', d => console.log('[vcam]', String(d)));
    vcamProc.on('exit', () => { vcamProc = null; emit('vcam', { on: false }); });
  }
  if (!on && vcamProc) { try { vcamProc.kill(); } catch {} vcamProc = null; }
  emit('vcam', { on: !!vcamProc });
}

// ---------- http ----------

// ======================================================================
// THE SET (the dashboard's territory): three layers — BACK (image/video background), MIDDLE (the lion + chair:
// our video clips, or Codex's transparent 3D render), FRONT (frames, effects, gifts, captions, click-to-play clips).
// Scenes save all of it; the whole lion+chair set moves/scales as one piece. Codex's engine is reached through a bridge.
// ======================================================================
for (const d of ['media/bg', 'media/front', 'media/clips', 'media/thumbs']) fs.mkdirSync(P(d), { recursive: true });
let set = { ...{ mode: 'video', bg: null, dim: 0, front: [], frame: { x: 0, y: 0, scale: 1, shot: 'full' }, render: null, scene: '' }, ...loadJ('set.json', {}) };
let scenes = loadJ('scenes.json', []);     // [{id, name, bg, dim, front, frame, mode, thumb, created}]
let clips = loadJ('clips.json', []);       // [{id, name, file, secs, audio, thumb, size:'full'|'inset', count, created}]
let assets = loadJ('assets.json', { bg: [], front: [] });   // [{file, name, type:'image'|'video', thumb, secs}]
let clipPlaying = null;                    // {id, file, audio, since}
function setEmit() { emit('set', set); }
const SAFE = n => String(n || 'file').replace(/[^\w.\-֐-׿ ]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
function ffprobeLite(file) {   // duration + has-audio from ffmpeg's own banner (no ffprobe in the imageio build)
  return new Promise(async res => { const ff = await ffmpegPath(); execFile(ff, ['-hide_banner', '-i', file], { windowsHide: true, timeout: 20000 }, (e, out, err) => { const t = String(err || '') + String(out || ''); const m = t.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/); const secs = m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0; res({ secs: Math.round(secs * 10) / 10, audio: /Stream #\d+:\d+.*Audio/.test(t), video: /Stream #\d+:\d+.*Video/.test(t) }); }); });
}
function thumbOf(file, out, isVideo) {
  return new Promise(async res => { const ff = await ffmpegPath(); const args = isVideo ? ['-y', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'scale=360:-2', out] : ['-y', '-i', file, '-vf', 'scale=360:-2', out]; execFile(ff, args, { windowsHide: true, timeout: 30000 }, e => res(!e && fs.existsSync(out))); });
}
async function addAsset(kind, name, buf) {
  const ext = (path.extname(name) || '').toLowerCase(); const isVideo = /\.(mp4|webm|mov|m4v)$/.test(ext); const isImage = /\.(png|jpg|jpeg|webp|gif)$/.test(ext);
  if (!isVideo && !isImage) throw new Error('סוג קובץ לא נתמך: ' + ext);
  let base = SAFE(path.basename(name, ext)); let file = base + ext; if (fs.existsSync(P('media', kind, file))) file = base + '_' + Date.now().toString(36) + ext;
  const fp = P('media', kind, file); fs.writeFileSync(fp, buf);
  const thumbExt = kind === 'front' && !isVideo ? '.png' : '.jpg'; const th = kind + '_' + path.basename(file, ext) + thumbExt;
  const ok = await thumbOf(fp, P('media', 'thumbs', th), isVideo);
  const info = isVideo ? await ffprobeLite(fp) : { secs: 0, audio: false };
  const item = { id: crypto.randomBytes(4).toString('hex'), name: base, file: `/media/${kind}/${file}`, type: isVideo ? 'video' : 'image', thumb: ok ? `/media/thumbs/${th}` : (isImage ? `/media/${kind}/${file}` : ''), secs: info.secs, audio: !!info.audio, created: Date.now() };
  if (kind === 'clips') { clips.unshift({ ...item, size: 'full', count: 0 }); saveJ('clips.json', clips); emit('clips', { clips }); }
  else { assets[kind] = assets[kind] || []; assets[kind].unshift(item); saveJ('assets.json', assets); emit('assets', assets); }
  return item;
}
function removeAsset(kind, id) {
  const list = kind === 'clips' ? clips : (assets[kind] || []); const i = list.findIndex(x => x.id === id); if (i < 0) return false;
  const it = list.splice(i, 1)[0]; for (const f of [it.file, it.thumb]) { if (f && f.startsWith('/media/')) { try { fs.unlinkSync(P(f.slice(1))); } catch {} } }
  if (kind === 'clips') { saveJ('clips.json', clips); emit('clips', { clips }); } else { saveJ('assets.json', assets); emit('assets', assets); }
  return true;
}
function playClip(id) {
  const c = clips.find(x => x.id === id); if (!c) throw new Error('סרטון לא נמצא');
  if (clipPlaying && Date.now() - clipPlaying.since < 1200) return clipPlaying;     // one press = one play
  c.count++; c.last = Date.now(); saveJ('clips.json', clips);
  clipPlaying = { id: c.id, file: c.file, audio: c.audio, size: c.size || 'full', since: Date.now() };
  emit('clip', { ...clipPlaying, secs: c.secs });
  if (c.audio) { engineEvent('video_start', { secs: c.secs, name: c.name }); if (spotify.playing) try { duck(true); } catch {} }
  emit('status', { msg: `🎬 סרטון: ${c.name}${c.audio ? ' 🔊' : ''}` });
  return clipPlaying;
}
function clipEnded(reason = 'ended') {
  if (!clipPlaying) return; const was = clipPlaying; clipPlaying = null;
  if (was.audio) { engineEvent('video_end', { reason }); if (spotify.playing) try { duck(false); } catch {} }
  emit('clipState', { playing: null });
}
// scenes: a snapshot of the whole set
function saveScene(name) {
  const sc = { id: crypto.randomBytes(4).toString('hex'), name: String(name || 'סצנה ' + (scenes.length + 1)).slice(0, 40), bg: set.bg, dim: set.dim, front: set.front, frame: set.frame, mode: set.mode, render: set.render, thumb: set.bg?.thumb || '', created: Date.now() };
  scenes.push(sc); saveJ('scenes.json', scenes); set.scene = sc.id; saveJ('set.json', set); emit('scenes', { scenes }); setEmit(); return sc;
}
function applyScene(id) {
  const sc = scenes.find(x => x.id === id); if (!sc) throw new Error('סצנה לא נמצאה');
  set = { ...set, bg: sc.bg, dim: sc.dim, front: sc.front, frame: sc.frame, mode: sc.mode || set.mode, render: sc.render ?? set.render, scene: sc.id };
  saveJ('set.json', set); setEmit(); if (engine.online && sc.frame?.shot) engineCall(EMAP.camera, { shot: sc.frame.shot, framing: sc.frame.shot === 'close' ? 'portrait' : 'seated' }).catch(() => {});
  emit('status', { msg: `🎭 סצנה: ${sc.name}` }); return sc;
}


// ======================================================================
// OPPONENT SCREEN: the opponent's LIVE fills our whole frame (pulled straight from TikTok's CDN, proxied to the stage),
// and transparent EFFECTS (punches, hits, anything) are layered on top of him. Nothing of ours is visible meanwhile.
// ======================================================================
fs.mkdirSync(P('media', 'fx'), { recursive: true });
let oppLive = { on: false, user: '', roomId: '', url: '', title: '', token: '', status: 'כבוי', muted: true, show: false, since: 0, view: { ...{ preset: 'full', scale: 1, x: 0, y: 0 }, ...(loadJ('oppview.json', {})) } };
// presets for TikTok's battle composite (two 9:16 panels side by side in the middle band): zoom ×2 on one panel fills our frame exactly
const OPP_VIEWS = { full: { scale: 1, x: 0, y: 0 }, right: { scale: 2, x: -50, y: 0 }, left: { scale: 2, x: 50, y: 0 } };
const flvTokens = new Map();   // token -> upstream FLV url (never exposed to the page)
function oppLiveEmit() { emit('oppLive', { on: oppLive.on, user: oppLive.user, src: oppLive.token ? '/proxy/flv/' + oppLive.token : '', status: oppLive.status, title: oppLive.title, muted: oppLive.muted, show: oppLive.show !== false, view: oppLive.view }); }
async function oppScreenOn(user) {
  user = HANDLE(user || opp.handle); if (!user) throw new Error('אין שם משתמש של היריב — כתוב אותו או חכה שהקרב יזהה');
  oppLive = { ...oppLive, on: true, user, status: 'מחפש את השידור של ' + user + '…', since: Date.now() }; oppLiveEmit();
  let url = '', roomId = '', title = '';
  const v = await ttRoomVideo(user, '');
  if (v && v.alive && v.url) { url = v.url; roomId = v.roomId; title = v.title; }
  else if (!v || v.alive !== false) {   // tik.tools unavailable → TikTok's own endpoint
    roomId = await roomIdOf(user); if (!roomId) { oppLive.status = user + ' לא בלייב כרגע'; oppLiveEmit(); return oppLive; }
    const { d } = await roomInfoRaw(roomId); const su = d.stream_url || {}; const flv = su.flv_pull_url || {};
    url = flv.HD1 || flv.FULL_HD1 || flv.SD1 || flv.SD2 || Object.values(flv)[0] || ''; title = d.title || ''; if (d.status === 4) url = '';
  }
  if (!url) { oppLive.status = user + ' לא בלייב כרגע'; oppLiveEmit(); return oppLive; }
  const token = crypto.randomBytes(8).toString('hex'); flvTokens.set(token, url); for (const k of [...flvTokens.keys()].slice(0, -4)) flvTokens.delete(k);
  oppLive = { ...oppLive, roomId, url, token, title, status: 'השידור של ' + user + ' על המסך ✓' }; oppLiveEmit();
  emit('status', { msg: `📺 מסך היריב: ${user}` }); return oppLive;
}
function oppScreenOff() { oppLive = { ...oppLive, on: false, token: '', url: '', status: 'כבוי' }; oppLiveEmit(); emit('status', { msg: '📺 מסך היריב כבוי — חזרנו לאריה' }); }
// pass the FLV through to the stage (same origin → no CORS, no key leaves the server)
async function proxyFlv(req, res, token) {
  const up = flvTokens.get(token); if (!up) { res.writeHead(404); return res.end(); }
  try {
    const r = await fetch(up, { headers: { ...TT_H, Referer: 'https://www.tiktok.com/' } });
    if (!r.ok || !r.body) { res.writeHead(502); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'video/x-flv', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    const body = Readable.fromWeb(r.body); body.pipe(res); req.on('close', () => { try { body.destroy(); } catch {} });
  } catch (e) { console.log('[flv proxy]', e.message); try { res.writeHead(502); res.end(); } catch {} }
}
// transparent one-shot effects. A green-screen MP4 is converted on upload into a WebM with real alpha.
let fx = loadJ('fx.json', []);        // [{id, name, file, thumb, secs, created, dir}]
function fxEmit() { emit('fxlib', { fx }); }
async function isGreenScreen(file) {
  return new Promise(async res => { const ff = await ffmpegPath(); execFile(ff, ['-hide_banner', '-loglevel', 'error', '-ss', '0.3', '-i', file, '-frames:v', '1', '-vf', 'scale=8:8', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { windowsHide: true, timeout: 20000, encoding: 'buffer', maxBuffer: 1 << 20 }, (e, out) => {
    if (e || !out || out.length < 192) return res(false); let g = 0; const px = out.length / 3;
    for (let i = 0; i < px; i++) { const r = out[i * 3], gg = out[i * 3 + 1], b = out[i * 3 + 2]; if (gg > 90 && gg > r + 40 && gg > b + 40) g++; }
    res(g / px > 0.3); }); });
}
function toAlphaWebm(inFile, outFile) {
  return new Promise(async res => { const ff = await ffmpegPath(); execFile(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-i', inFile, '-vf', 'chromakey=0x00ff00:0.32:0.08,despill=type=green,format=yuva420p', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '2M', '-row-mt', '1', '-an', outFile], { windowsHide: true, timeout: 600000 }, e => res(!e && fs.existsSync(outFile))); });
}
async function addFx(name, buf) {
  const ext = (path.extname(name) || '').toLowerCase(); if (!/\.(webm|mp4|mov)$/.test(ext)) throw new Error('אפקט חייב להיות וידאו (webm שקוף או mp4 על מסך ירוק)');
  const base = SAFE(path.basename(name, ext)); let file = base + ext; if (fs.existsSync(P('media', 'fx', file))) file = base + '_' + Date.now().toString(36) + ext;
  let fp = P('media', 'fx', file); fs.writeFileSync(fp, buf); let converted = false;
  if (ext !== '.webm' && await isGreenScreen(fp)) { const out = fp.replace(/\.\w+$/, '.webm'); emit('status', { msg: `🟩 מסך ירוק זוהה — הופך את "${base}" לשקוף…` }); if (await toAlphaWebm(fp, out)) { try { fs.unlinkSync(fp); } catch {} fp = out; file = path.basename(out); converted = true; } }
  const th = 'fx_' + path.basename(file, path.extname(file)) + '.png';
  await new Promise(async res => { const ff = await ffmpegPath(); execFile(ff, ['-y', ...(fp.endsWith('.webm') ? ['-c:v', 'libvpx-vp9'] : []), '-ss', '0.4', '-i', fp, '-frames:v', '1', '-vf', 'scale=360:-2', P('media', 'thumbs', th)], { windowsHide: true, timeout: 30000 }, () => res()); });
  const info = await ffprobeLite(fp);
  const item = { id: crypto.randomBytes(4).toString('hex'), name: base, file: '/media/fx/' + file, thumb: fs.existsSync(P('media', 'thumbs', th)) ? '/media/thumbs/' + th : '', secs: info.secs, alpha: file.endsWith('.webm'), converted, created: Date.now() };
  fx.unshift(item); saveJ('fx.json', fx); fxEmit(); return item;
}
// head-swap clips: processed by tools/overlay_proc.py in the background
const ovJobs = {};   // id -> {status, frames, started}
function ovProcess(id, srcf, keep) {
  ovJobs[id] = { status: 'מעבד…', frames: 0, started: Date.now(), keep };
  emit('status', { msg: `🎭 מעבד סרטון להחלפת ראש: ${id}${keep ? '' : ' (חיתוך רקע — לוקח זמן)'}` }); emit('overlays', {});
  const pr = spawn('py', ['-3.13', '-u', P('tools', 'overlay_proc.py'), srcf, id, ...(keep ? ['--keep'] : [])], { windowsHide: true });
  let out = ''; pr.stdout.on('data', d => { out += d; const m = String(d).match(/(\d+)\s*$/); if (m) ovJobs[id].frames = +m[1]; if (/DONE/.test(String(d))) { ovJobs[id].status = 'מוכן'; } });
  let err = ''; pr.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-2000); });
  pr.on('exit', code => { if (code === 0 && /DONE/.test(out)) { delete ovJobs[id]; for (const j of genJobs) if (j.ovId === id) { j.status = '✓ מוכן — אפשר לשגר ללייב'; j.step = 6; j.ready = true; const ak = String(j.user || '').toLowerCase() + '|' + j.boxer; if (autoLaunch.has(ak)) { autoLaunch.delete(ak); launchClip(id); emit('status', { msg: `🚀 שוגר ללייב: ${j.he || id}` }); autoLaunchEmit(); } } emit('status', { msg: `🎭 סרטון מוכן: ${id} — בחר למי מחליפים את הראש` }); } else { ovJobs[id].status = 'נכשל: ' + err.slice(-300); for (const j of genJobs) if (j.ovId === id) { j.status = 'נכשל בחיתוך לשקוף'; j.error = 'cut'; } emit('status', { msg: `🎭 עיבוד נכשל: ${id}` }); console.log('[overlay_proc]', err.slice(-500)); } emit('overlays', {}); genEmit(); });
}
let faceRemote = null, lastFaceEmit = 0;
let lastFxAt = 0;
function playFx(id, opts = {}) {
  const f = fx.find(x => x.id === id); if (!f) throw new Error('אפקט לא נמצא');
  if (Date.now() - lastFxAt < 350) return f; lastFxAt = Date.now();     // one press = one punch
  f.count = (f.count || 0) + 1; saveJ('fx.json', fx);
  emit('fx', { id: f.id, file: f.file, secs: f.secs, aim: opts.aim || f.aim || 'face', impact: f.impact || { x: 0.5, y: 0.42 }, fit: f.fit !== false, flip: !!opts.flip, scale: opts.scale || f.scale || 1, hit: f.hit !== false, hitAt: f.hitAt ?? 0.6, power: f.power || 1, game: !!opts.game }); return f;
}


// ======================================================================
// CHARACTER FACTORY (RunPod public endpoints — pay per clip, nothing left running):
// text → green-screen still (qwen-image) → image-to-video (wan 2.2) → chroma key → our library (effect / character / head-swap body)
// ======================================================================
const genJobs = [];     // [{id, desc, kind, status, step, cost, file, error, t}]
function genEmit() { const now = Date.now(); for (const j of genJobs) { j.at = j.at || {}; if (j.at[j.step] == null) j.at[j.step] = now; } emit('genjobs', { jobs: genJobs.slice(0, 20), now }); }   // j.at = when each step started → the progress bars
async function runpod(slug, input) {
  if (!settings.runpodKey) throw new Error('אין מפתח RunPod — שמור אותו בלוח (הסט → RunPod)');
  const r = await fetch(`https://api.runpod.ai/v2/${slug}/runsync`, { method: 'POST', headers: { Authorization: 'Bearer ' + settings.runpodKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ input }), signal: AbortSignal.timeout(600000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === 'FAILED' || j.error) throw new Error(j.error || j.message || ('RunPod ' + r.status));
  if (j.status && j.status !== 'COMPLETED' && j.id) {   // still queued → poll
    for (let i = 0; i < 120; i++) { await new Promise(res => setTimeout(res, 5000)); const s2 = await fetch(`https://api.runpod.ai/v2/${slug}/status/${j.id}`, { headers: { Authorization: 'Bearer ' + settings.runpodKey } }); const k = await s2.json().catch(() => ({})); if (k.status === 'COMPLETED') return k; if (k.status === 'FAILED') throw new Error(k.error || 'RunPod failed'); }
    throw new Error('RunPod timeout');
  }
  return j;
}
const GREEN_BG = 'on a perfectly flat, evenly lit, pure bright green chroma-key background (#00FF00), no shadows on the background, no floor, no text, no watermark';
// a still of an existing character (first clean frame of its clip) composited on green — the seed for a NEW motion of the same character
function overlayStill(id) {
  return new Promise(async (res, rej) => { const ff = await ffmpegPath(); const src = P('media', 'overlays', id + '.webm'); if (!fs.existsSync(src)) return rej(new Error('אין דמות כזו')); const out = P('data', 'still_' + id + '.png');
    execFile(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=720x1280', '-c:v', 'libvpx-vp9', '-ss', '0.4', '-i', src, '-filter_complex', '[1:v]scale=-2:1120[fg];[0:v][fg]overlay=(W-w)/2:H-h-40:shortest=1', '-frames:v', '1', out], { windowsHide: true, timeout: 60000 }, e => e ? rej(e) : res(out)); });
}
async function createCharacter({ desc, kind = 'character', dur = 5, he = '', motion = '', fromOverlay = '' }) {
  const job = { id: crypto.randomBytes(4).toString('hex'), desc: desc || ('מתוך ' + fromOverlay), kind, he, status: 'מתחיל…', step: 0, cost: 0, t: Date.now() }; genJobs.unshift(job); if (genJobs.length > 40) genJobs.pop(); genEmit();
  (async () => {
    try {
      // 1) still — drawn new, or taken from an existing character so the new clip keeps the same figure (sent inline as a data URL — nothing is published anywhere)
      let imgUrl;
      if (fromOverlay) { job.status = '🖼 לוקח את הדמות הקיימת…'; job.step = 1; genEmit(); const still = await overlayStill(fromOverlay); imgUrl = 'data:image/png;base64,' + fs.readFileSync(still).toString('base64'); }
      else {
        job.status = '🖼 מצייר את הדמות…'; job.step = 1; genEmit();
        const style = kind === 'effect' ? `${desc}, single object, centered, 3D cartoon render, bold shapes, clean edges` : `${desc}, full body visible head to toe, centered, facing the camera, 3D cartoon character (Pixar style), big expressive features, clean silhouette`;
        const img = await runpod('qwen-image-t2i', { prompt: `${style}, ${GREEN_BG}`, negative_prompt: 'text, watermark, logo, blurry, cropped, multiple characters, shadow on background, gradient background', size: '720*1280', seed: -1, enable_safety_checker: true });
        imgUrl = img?.output?.result; job.cost += +(img?.output?.cost || 0); if (!imgUrl) throw new Error('לא התקבלה תמונה');
      }
      job.img = imgUrl; job.status = '🎬 מניע את הדמות…'; job.step = 2; genEmit();
      // 2) motion
      const mv = motion || (kind === 'effect' ? `${desc} flies fast toward the camera and splats/hits at the end, exaggerated cartoon motion` : kind === 'puncher' ? `the character throws big exaggerated boxing punches toward the camera, bouncing on its feet, cartoon energy` : `the character moves playfully, bounces, waves and gestures with big cartoon energy, stays fully in frame`);
      let vid; try { vid = await runpod('wan-2-2-i2v-720', { prompt: `${mv}. The background stays a flat solid green screen the whole time. The character stays fully inside the frame.`, image: imgUrl, num_inference_steps: 30, guidance: 5, size: '720*1280', duration: dur, seed: -1, enable_prompt_optimization: false, enable_safety_checker: true }); }
      catch (e) { if (/size/i.test(e.message)) vid = await runpod('wan-2-2-i2v-720', { prompt: `${mv}. The background stays a flat solid green screen the whole time.`, image: imgUrl, num_inference_steps: 30, guidance: 5, duration: dur, seed: -1 }); else throw e; }
      const vidUrl = vid?.output?.result; job.cost += +(vid?.output?.cost || 0); if (!vidUrl) throw new Error('לא התקבל וידאו');
      job.status = '⬇️ מוריד והופך לשקוף…'; job.step = 3; genEmit();
      const buf = Buffer.from(await (await fetch(vidUrl)).arrayBuffer());
      const name = SAFE(he || desc.split(/[,.]/)[0]).slice(0, 30) || 'char';
      if (kind === 'effect') { const it = await addFx(name + '.mp4', buf); job.file = it.file; job.status = '✓ מוכן באפקטים'; }
      else { const id = 'ov_' + name.replace(/[^\w-]/g, '_') + '_' + Date.now().toString(36); fs.mkdirSync(P('data', 'ovsrc'), { recursive: true }); const srcf = P('data', 'ovsrc', id + '.mp4'); fs.writeFileSync(srcf, buf); const names = loadJ('overlays.json', {}); names[id] = { he: he || desc.slice(0, 30), face: 0, hitAt: 1.2, pos: 'center', size: 0.5, bottom: 0.26 }; saveJ('overlays.json', names); ovProcess(id, srcf, false); job.file = '/media/overlays/' + id + '.webm'; job.status = '✓ הורד — מעבד שקיפות ומעקב…'; }
      job.step = 4; genEmit(); emit('status', { msg: `🎬 דמות חדשה: ${name} ($${job.cost.toFixed(2)})` });
    } catch (e) { job.status = 'נכשל: ' + e.message; job.error = e.message; genEmit(); emit('status', { msg: '🎬 יצירה נכשלה: ' + e.message }); }
  })();
  return job;
}


// ---------- "זהה וייצר": a frame of the opponent's live → his head+body (opp_detect.py) → the Turkish boxer punches him (gen_pair.py, RunPod) → transparent → library ----------
const oppCaps = [];     // recent captures shown in the desk: {id,user,t,frame,boxed,head,green,face,body}
function runPyJson(args, timeout = 240000) {
  return new Promise((res, rej) => { execFile('py', ['-3.13', '-u', ...args], { cwd: ROOT, windowsHide: true, timeout, maxBuffer: 8e6 }, (e, so, se) => { if (e) return rej(new Error(String(se || e.message).trim().split('\n').pop().slice(0, 220))); const line = String(so).trim().split('\n').filter(l => l.startsWith('{')).pop(); try { res(JSON.parse(line)); } catch { rej(new Error('בלי תשובה: ' + String(so).slice(-200))); } }); });
}
function grabFrames(url, base, n = 2) {   // a couple of frames from the live, 1.5s apart
  return new Promise(async (res, rej) => { const ff = await ffmpegPath(); execFile(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-rw_timeout', '20000000', '-i', url, '-t', String(1.5 * n + 1), '-vf', 'fps=1/1.5,scale=720:-2', '-frames:v', String(n), base + '_%d.jpg'], { windowsHide: true, timeout: 60000 }, (e, so, se) => { const got = []; for (let i = 1; i <= n; i++) if (fs.existsSync(`${base}_${i}.jpg`)) got.push(`${base}_${i}.jpg`); got.length ? res(got) : rej(new Error('לא הצלחתי לקחת פריים מהשידור: ' + String(se || e?.message || '').split('\n').pop().slice(0, 120))); }); });
}
async function ownerAvatar(user, v) {   // the live owner's profile picture → data/avatars/<user>.jpg (cached a day)
  try { fs.mkdirSync(P('data', 'avatars'), { recursive: true }); const f = P('data', 'avatars', user.replace(/[^\w.]/g, '_') + '.jpg');
    if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 86400e3) return f;
    const url = v?.avatar; if (!url) return fs.existsSync(f) ? f : '';
    const buf = Buffer.from(await (await fetch(url, { headers: TT_H })).arrayBuffer()); if (buf.length < 2000) return fs.existsSync(f) ? f : '';
    // webp → jpg so OpenCV reads it
    const ff = await ffmpegPath(); const tmp = f + '.webp'; fs.writeFileSync(tmp, buf);
    await new Promise(res => execFile(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-i', tmp, '-frames:v', '1', '-q:v', '2', f], { windowsHide: true, timeout: 20000 }, () => res()));
    try { fs.unlinkSync(tmp); } catch {} return fs.existsSync(f) ? f : '';
  } catch (e) { console.log('[avatar]', e.message); return ''; }
}
async function oppCapture({ user, side = '', wait = false }) {
  user = HANDLE(user || oppLive.user || opp.handle); if (!user) throw new Error('אין שם משתמש של היריב (לא כינוי) — כתוב אותו או חכה שהקרב יזהה');
  const v = await ttRoomVideo(user, ''); if (!v || !v.alive || !v.url) throw new Error(`${user} לא בלייב כרגע`); const url = v.url;
  const ref = await ownerAvatar(user, v);      // his profile picture: the face we must find
  const id = Date.now().toString(36); fs.mkdirSync(P('media', 'rejected'), { recursive: true });
  let best = null; const t0 = Date.now(); let round = 0;
  do {   // a few frames, pick the clearest face; with wait=true keep watching (up to ~75s) until he looks at the camera
    const base = P('media', 'rejected', `cap_${id}_${round}`); let frames = [];
    try { frames = await grabFrames(url, base, 3); } catch (e) { if (!best) throw e; break; }
    for (const f of frames) { const b = f.replace(/\.jpg$/, ''); try { const d = await runPyJson([P('tools', 'opp_detect.py'), f, b, ...(side ? ['--side', side] : []), ...(ref ? ['--ref', ref] : [])], 120000); const q = faceQuality(d) * (d.verified ? 1.25 : (d.faces || []).length > 1 ? 0.7 : 1); if (!best || q > best.q) best = { ...d, q, base: b }; } catch (e) { console.log('[opp_detect]', e.message); } }
    round++; if (wait) emit('oppcap_wait', { user, round, q: best?.q || 0, secs: Math.round((Date.now() - t0) / 1000), msg: best?.q >= GOOD_ANGLE ? 'זווית טובה ✓' : `מחכה לזווית טובה… (${Math.round((Date.now() - t0) / 1000)} שנ׳, איכות ${(best?.q || 0).toFixed(2)})` });
  } while (wait && (!best || best.q < GOOD_ANGLE) && Date.now() - t0 < 75000);
  if (!best) throw new Error('לא הצלחתי לנתח את הפריים');
  best.ok = best.q >= 1; best.why = best.ok ? '' : (!best.face ? 'לא רואים פנים בשידור' : 'הפנים קטנות מדי / חתוכות בקצה הפריים — חכה שיסתכל למצלמה ונסה שוב');
  const rel = p => '/media/rejected/' + path.basename(p);
  const cap = { id, user, t: Date.now(), side, ok: best.ok, why: best.why, q: Math.round(best.q * 100) / 100, frontal: best.frontal, faces: best.faces || [], pick: best.pick ?? -1, match: best.match ?? -1, sims: best.sims || [], verified: !!best.verified, avatar: ref ? '/data/avatars/' + path.basename(ref) : '', ref, base: best.base, face: best.face, body: best.body, frame: rel(best.base + '.jpg'), boxed: rel(best.base + '_boxed.jpg'), head: best.head ? rel(best.base + '_head.png') : '', green: best.green ? rel(best.base + '_green.jpg') : '', greenPath: best.green ? best.base + '_green.jpg' : '', headPath: best.head ? best.base + '_head.png' : '' };
  oppCaps.unshift(cap); if (oppCaps.length > 12) oppCaps.pop(); emit('oppcap', { cap: pubCap(cap) });
  if (cap.ok && cap.headPath && cap.greenPath && (cap.verified || (cap.faces || []).length <= 1)) saveHead(cap);
  return cap;
}
function saveHead(cap, force = false) {   // data/heads/<user>.png + _green.jpg + .json — his face, kept, so a set can be generated later without his live
  if (!cap.headPath || !fs.existsSync(cap.headPath) || fs.statSync(cap.headPath).size < 20000) return;   // an empty/broken cut is never kept
  const old = savedHead(cap.user); if (!force && old && (old.q || 1) >= (cap.q || 0) * 0.9) return;   // keep the head we have unless the new one is clearly better (a guest in his live once replaced him)
  try { fs.mkdirSync(P('data', 'heads'), { recursive: true }); const k = cap.user.replace(/[^\w.]/g, '_'); fs.copyFileSync(cap.headPath, P('data', 'heads', k + '.png')); fs.copyFileSync(cap.greenPath, P('data', 'heads', k + '_green.jpg')); fs.writeFileSync(P('data', 'heads', k + '.json'), JSON.stringify({ user: cap.user, t: Date.now(), face: cap.face, body: cap.body, verified: !!cap.verified, q: cap.q })); } catch (e) { console.log('[saveHead]', e.message); }
}
function savedHead(user) {
  const k = String(user || '').replace(/[^\w.]/g, '_'); const j = P('data', 'heads', k + '.json'); if (!fs.existsSync(j) || !fs.existsSync(P('data', 'heads', k + '.png'))) return null;
  try { const m = JSON.parse(fs.readFileSync(j, 'utf8')); return { id: 'saved_' + k, user, t: m.t, ok: true, why: '', q: m.q || 1, face: m.face, body: m.body, faces: [m.face], pick: 0, verified: !!m.verified, saved: true, head: '/data/heads/' + k + '.png', green: '/data/heads/' + k + '_green.jpg', headPath: P('data', 'heads', k + '.png'), greenPath: P('data', 'heads', k + '_green.jpg'), boxed: '/data/heads/' + k + '_green.jpg' }; } catch { return null; }
}
const pubCap = c => c && ({ ...c, greenPath: undefined, headPath: undefined, base: undefined, ref: undefined });
async function oppPick(capId, k) {   // same frame, a different person (the number the operator clicked)
  const cap = oppCaps.find(c => c.id === capId); if (!cap) throw new Error('התפיסה כבר לא קיימת — תפוס שוב');
  const d = await runPyJson([P('tools', 'opp_detect.py'), cap.base + '.jpg', cap.base, ...(cap.side ? ['--side', cap.side] : []), ...(cap.ref ? ['--ref', cap.ref] : []), '--pick', String(k)], 120000);
  const q = faceQuality(d); const ok = q >= 1;
  Object.assign(cap, { t: Date.now(), ok, why: ok ? '' : (!d.face ? 'לא רואים פנים' : 'הפנים קטנות / חתוכות — נסה פריים אחר'), q: Math.round(q * 100) / 100, frontal: d.frontal, faces: d.faces || [], pick: k, match: d.match ?? -1, sims: d.sims || [], verified: !!d.verified, face: d.face, body: d.body, head: d.head ? '/media/rejected/' + path.basename(cap.base + '_head.png') : '', green: d.green ? '/media/rejected/' + path.basename(cap.base + '_green.jpg') : '', greenPath: d.green ? cap.base + '_green.jpg' : '', headPath: d.head ? cap.base + '_head.png' : '' });
  if (ok && cap.headPath && cap.greenPath) saveHead(cap, true);   // the person the operator picked is the one we keep
  emit('oppcap', { cap: pubCap(cap) }); return cap;
}
const HANDLE = x => { x = String(x || '').replace(/^@/, '').trim(); return /^[\w.]{2,40}$/.test(x) ? x : ''; };   // a TikTok @username, never a nickname
function faceQuality(d) {   // 0 = no face; <1 = too small or cut at the edge (we don't pay for that); >=1 usable, bigger = better
  if (!d || !d.face) return 0; const [x, y, w, h] = d.face; const W = d.w || 720, H = d.h || 1280;
  const inside = x > W * 0.02 && y > H * 0.02 && x + w < W * 0.98 && y + h < H * 0.98;
  const size = h / H;   // face height vs frame height
  const angle = (0.45 + 0.55 * (d.frontal ?? 0.7)) * ((d.tilt ?? 0) > 0.35 ? 0.6 : 1);   // looking at the camera, head straight
  return (inside ? 1 : 0.3) * (size >= 0.07 ? 1 + size * 5 : size / 0.07 * 0.8) * angle;
}
const GOOD_ANGLE = 1.45;   // quality at which we stop waiting: a clear, straight, big enough face
function clipsOf(user) {   // the finished clips we already PAID for, per opponent
  user = String(user || '').replace(/^@/, '').trim().toLowerCase(); if (!user) return [];
  const names = loadJ('overlays.json', {});
  return Object.entries(names).filter(([id, o]) => o && typeof o === 'object' && o.kind === 'clip' && String(o.user || '').toLowerCase() === user && fs.existsSync(P('media', 'overlays', id + '.webm'))).map(([id, o]) => ({ id, he: o.he, boxer: o.boxer || 'boxer1' }));
}
const BOXER_SET = [{ id: 'boxer1', he: '🥊 הטורקי מרביץ' }, { id: 'boxer2', he: '🥊 הטורקי מתחמם ומרביץ' }, { id: 'boxer3', he: '👊 הטורקי — אגרוף ענק' }, { id: 'ov_baby', he: '👶 תינוק בוכה' }];   // every opponent gets one video per set   // the 3 punch sets — every opponent gets up to one video per set
// ---------- 💃 BODY effects (Shahak 2026-11-09: "turn him into a dancer — his head joined to the body", "add more cool ones"): Nano Banana draws HIS real head
// on a new body (blended at the neck, like the baby) → an OpenRouter video moves it → transparent overlay. Only a photo / his saved face is needed. On his click only.
const BODY_FX = {
  fx_belly:   { he: '💃 רקדנית בטן', size: 0.62, body: 'a curvy belly dancer in a full, modest, sparkly gold-and-red belly-dance costume with long flowing sleeves, a jingling coin belt and harem pants', move: 'dances a joyful belly dance: the hips shake fast from side to side, the arms wave like snakes above the head, the coin belt jingles, a proud funny diva attitude, a wink at the end' },
  fx_ballet:  { he: '🩰 בלרינה', size: 0.62, body: 'a ballerina in a fluffy pink tutu, a pink leotard and pink pointe shoes, standing on tiptoe with the arms up in a circle', move: 'dances clumsy ballet: spins on tiptoe, lifts one leg high, wobbles and almost falls, waves the arms gracefully, then makes a proud dramatic bow' },
  fx_chicken: { he: '🐔 תרנגולת', size: 0.5, body: 'a plump white farm chicken body with big feathered wings, orange chicken legs and a red comb on top of the head', move: 'struts like a chicken, flaps the wings wildly, pecks at the ground and jumps around in a funny panic like clucking loudly' },
  fx_bow:     { he: '🙇 משתחווה למלך', size: 0.45, pos: 'right', body: 'a small royal palace servant in a red-and-gold servant uniform with a little hat, kneeling on one knee', move: 'bows deeply again and again toward the left side of the frame as if greeting a king, hands pressed together, very respectful and funny' },
  // Shahak: "put the baby in the mother's arms and she shoves a milk bottle at him"
  fx_tiny:    { he: '🤏 קטן על הכף של צ׳ינו (📡 לשרת)', size: 0.5, body: 'that same person at their real adult size, in their own everyday clothes, standing upright facing the camera with both feet together, whole body visible head to toe, centered and large in the frame', move: 'stands in place facing the camera, waves hello with one hand, looks around amazed, keeps the feet planted in the same spot; the whole figure stays fully in frame' },
  fx_fan:     { he: '🪭 מנפנף לצ׳ינו (📡 לשרת)', size: 0.5, body: 'a small palace servant in a red-and-gold uniform with a little hat, standing and facing the camera, holding a big feather fan with both hands, whole body visible head to toe, centered', move: 'stands in place and fans slowly and respectfully toward the right side of the frame with the big feather fan, again and again, feet planted in the same spot; the whole figure stays fully in frame' },
  fx_babyarm: { he: '👶 תינוק בידיים של צ׳ינו (📡 לשרת)', size: 0.5, body: 'a cute chubby baby in a white onesie and a white bonnet, lying on its back and smiling at the camera, whole body visible head to toe, centered and large in the frame', move: 'lies in place on its back, giggles, kicks its little legs and waves its little arms happily, the head stays roughly in the same place; nothing else enters the frame' },
  fx_bottle:  { he: '🍼 תינוק לבקבוק של צ׳ינו (📡 לשרת)', size: 0.62, img: 'Create ONE photorealistic vertical 9:16 image. The image(s) show one real adult person (a TikTok streamer). Draw a cute chubby baby in a white onesie and a white bonnet, sitting up and smiling at the camera, whole body visible head to toe, centered and large in the frame, but with the REAL HEAD AND FACE of that person: keep their exact identity - same face shape, eyes, nose, beard or facial hair if any, skin tone and the same glasses if they wear them - so anyone who knows them instantly recognizes them. The head is slightly big for the baby body and joined naturally at the neck with matching skin and lighting, like a real photo, not a paste. The baby is alone in the picture: no other person, no objects, nothing in the hands. A playful, funny comedy image, friendly and sweet. Background: a perfectly flat, evenly lit, pure bright green chroma-key background (#00FF00), no floor, no shadows, no text, no watermark.', move: 'the baby sits in place facing the camera, giggles and babbles happily, smacks its lips and makes funny hungry faces, kicks its little legs and waves its little arms a bit; the head stays roughly in the same place; nothing else enters the frame' },
};
// ---------- 🦁 WITH CHINO, in the live (Shahak: "the lion holds the bottle and shoves it at him — how do I blend it with the lion in the live?"):
// Nano Banana draws the SAME lion as the live camera (media/master.png = the first frame of every idle loop) doing it to HIM (his real face),
// Veo moves it, and it plays FULL-FRAME over the camera for 4 seconds — so it is the live lion himself doing it. No cut-out.
const LION_FX = {
  lion_bottle: { he: '🦁🍼 צ׳ינו נותן לו בקבוק', scene: "the lion holds the person in his big arms as a chubby baby in a white onesie and a white bonnet - the baby has the person's REAL adult face, the head a bit big for the baby body and joined naturally at the neck - and with his other paw the lion pushes a big milk bottle into the baby's mouth", move: "the lion rocks the baby in his arms and keeps pushing the big milk bottle into the baby's mouth, the baby wriggles, protests and makes funny faces, milk dribbles down the chin, the lion smirks proudly at the camera" },
  lion_kuchi:  { he: '🦁👶 קוצ׳י קוצ׳י על הברכיים', scene: "the person, as a chubby baby in a white bonnet and a diaper with the person's REAL adult face (the head a bit big, joined naturally at the neck), sits on the lion's knees crying with big tears while the lion looks down at the baby amused", move: "the baby cries on the lion's knees, the lion tickles the baby's belly with one big paw (kuchi kuchi), the baby bursts into giggles and claps its little hands, the lion smirks proudly at the camera" },
  lion_baby:   { he: '🦁🍼 תינוק בידיים של צ׳ינו', scene: "the lion holds the person in his arms as a chubby baby wrapped in a soft white blanket with a white bonnet - the baby has the person's REAL adult face - and smiles proudly like a father", move: 'the lion gently rocks the baby in his arms, the baby giggles and kicks its little legs, the lion smirks at the camera' },
  lion_bow:    { he: '🦁🙇 משתחווה לצ׳ינו', scene: 'the person, small, in a red-and-gold royal servant outfit, kneels on the step in front of the throne bowing to the lion, who looks down with a proud smirk', move: 'the servant bows again and again toward the lion, the lion nods slowly like a king accepting respect' },
  lion_fan:    { he: '🦁🪭 מנפנף לצ׳ינו', scene: 'the person, as a palace servant in a red-and-gold uniform, stands next to the throne fanning the lion with a big golden palm-leaf fan', move: 'the servant fans the lion with big rhythmic strokes, the lion leans back enjoying it, his mane blowing in the breeze' },
  lion_tiny:   { he: '🦁🤏 קטן על הכף של צ׳ינו', scene: "the person, tiny, sits on the lion's open paw at chest height while the lion looks at them amused", move: "the tiny person waves and jumps on the lion's paw, the lion raises an eyebrow and laughs silently" },
  // Shahak: "Chino's movement should be BIG — he grabs the chicken by the head, lifts it and it jumps; the ballerina by the hand"
  lion_chicken: { he: '🦁🐔 צ׳ינו מרים את התרנגולת', scene: "the person, as a plump white chicken (a chicken body with big feathered wings, orange legs and a red comb, with the person's REAL head and face, joined naturally at the neck), is just entering the picture from the left edge: it stands on the left armrest of the throne right next to the lion's left paw, with its feet at about 65 percent of the way down the picture, clearly between the lion's chest and his knees, partly cut by the left edge. The lion's left paw stays resting on the armrest, visible and untouched, and the chicken does not stand on it. The lion stays in EXACTLY the same calm seated pose, the same zoom and the same framing as image 1: both paws resting on the armrests, head level, looking at the camera - nothing about him changed, only the chicken is added. Nothing at all in the bottom 20 percent of the picture", move: "The figure on the armrest has a REAL HUMAN HEAD and face (with a small red comb on top) on a white chicken body: it has NO beak and NO chicken head, ever. It faces straight into the camera in every single frame, its human face clearly visible, sharp and unchanged: it never turns its head or body to the side, never shows a profile or its back. It takes two small sideways steps along the armrest toward the lion, body and face still toward the camera, while the lion looks down at it with a warm proud smile and gently strokes its back with his free big paw (soft petting, never the head or the neck, no grabbing). Then the person's face tilts back a little and crows cock-a-doodle-doo with its human mouth wide open, still facing the camera, and then the figure ducks down behind the left armrest and is gone. In the last second the lion is alone, back in exactly the same calm seated pose as in the very first frame, both paws resting on the armrests, looking at the camera. Slow, calm, small movements: nothing violent, no throwing, no dropping, no squeezing, no paw over the face" },
  lion_ballet:  { he: '🦁🩰 צ׳ינו רוקד עם הבלרינה', scene: "the person, as a ballerina in a fluffy pink tutu, pink tights and pink pointe shoes, with the person's REAL head and face (joined naturally at the neck), stands on the floor right beside the left side of the throne, facing the camera, one arm raised gracefully and the other resting lightly on the left armrest; she is big and clearly visible, her head at the height of the lion's shoulder and her whole upper body and skirt in the middle band of the picture. The lion stays EXACTLY in the same calm seated pose, the same zoom and the same framing as image 1: both paws resting on the armrests, head level, looking at the camera - nothing about him changed, only the ballerina is added", move: "the ballerina dances beside the throne - graceful slow arm movements, a gentle turn on her toes, a small bow - while the lion dances with her from his seat: he sways his shoulders and head to the rhythm, lifts his paw on her side off the armrest and gently holds her hand up high for a moment while she turns under it, then lets go. Her REAL human face stays clearly visible, sharp and unchanged in every frame, facing the camera as much as possible, and her body stays large in the picture. In the last second the lion is back in exactly the same calm seated pose as in the very first frame, both paws resting on the armrests, looking at the camera, and the ballerina stands in a final graceful pose beside him. Slow, calm, gentle movements: nothing violent, no throwing, no dropping, no squeezing, no paw over the face. The camera never moves" },
  lion_belly:   { he: '🦁💃 רוקדת בטן לצ׳ינו', scene: "the person, as a belly dancer in a full, modest, sparkly gold-and-red costume with the person's REAL head and face, dances on the step in front of the throne while the lion watches", move: "the belly dancer shakes the hips fast in front of the lion, the lion leans forward, claps his big paws to the beat and nods, then stands up and dances along with big royal moves" },
};
const LION_IMG = s => `Image 1 is CHINO: a crowned lion king seated on a red velvet golden throne in a dark striped room. Keep him EXACTLY the same - same face, mane, crown, gold chains, throne, room, lighting and the same camera framing as image 1. The other image(s) show one real adult person (a TikTok streamer). Create ONE photorealistic vertical 9:16 image in exactly the same scene and framing as image 1, where ${s}. Keep the person's REAL face: same face shape, eyes, nose, beard or facial hair, skin tone, hair or hat and glasses - anyone who knows them recognizes them instantly. A playful, funny comedy image, never humiliating, nothing sexual or violent. No text, no logos, no watermark.`;
const LION_VID = m => `Animate this exact image. Locked-off static camera, the same crowned lion king on the same throne in the same room: ${m}. The lion keeps his exact look (face, mane, crown, gold chains) and the person keeps the same face in every frame. The camera never moves or zooms, no cuts, no text.`;
const previews = new Map();   // 👁 preview job id → {still, user, set}: the picture he saw and approved becomes the first frame of the paid video
const ALL_SETS = [...BOXER_SET, ...Object.entries(BODY_FX).map(([id, v]) => ({ id, he: v.he, body: true })), ...Object.entries(LION_FX).map(([id, v]) => ({ id, he: v.he, lion: true }))];
const BODY_IMG = b => `Create ONE photorealistic vertical 9:16 image. The image(s) show one real adult person (a TikTok streamer). Draw ${b} - but with the REAL HEAD AND FACE of that person: keep their exact identity - same face shape, eyes, nose, beard or facial hair if any, skin tone, the same hair or hat and the same glasses if they wear them - so anyone who knows them instantly recognizes them. The head is joined naturally to the new body at the neck, matching skin tone and lighting, like a real photo, not a paste. The whole figure is visible from head to toe, centered, facing the camera. A playful, funny comedy image, never humiliating, nothing sexual. Background: a perfectly flat, evenly lit, pure bright green chroma-key background (#00FF00), no floor, no shadows, no objects, no text, no watermark.`;
const BODY_VID = m => `The figure on the flat green screen ${m}. Keep exactly the same face, hair or hat and glasses in every frame. The camera never moves or zooms: one wide static shot, the whole figure stays fully inside the frame, the flat bright green background stays unchanged, no other objects, no text.`;
async function opponentPunch({ capId, user, side, dur = 5, boxer = 'boxer1', again = false, wait = true, set = '', fullBody = false, photo = '', preview = false, still = '' }) {
  let cap = capId ? oppCaps.find(c => c.id === capId) : null;
  const who = cap?.user || HANDLE(user || oppLive.user || opp.handle);
  if (!cap && photo && fs.existsSync(photo)) cap = { id: 'photo_' + pkey(who), user: who, ok: true, face: [0, 0, 1, 1], faces: [], verified: true, saved: true, headPath: photo, greenPath: photo, head: '', boxed: '' };   // the baby only needs a photo of him (any person, live or not)
  const running = genJobs.find(j => j.kind === 'opponent' && j.user === who && !j.error && j.step < 5 && Date.now() - j.t < 10 * 60000 && (!set || !j.boxer || j.boxer === set));
  if (running) return { exists: true, running: true, user: who, clips: [], msg: `כבר מייצר ל-${who} עכשיו (${running.status}) — אין צורך ללחוץ שוב` };
  const have = clipsOf(who);
  const nextSet = set ? ALL_SETS.find(b => b.id === set) : BOXER_SET.find(b => !have.some(c => c.boxer === b.id));     // a named set (any effect), or the first punch set this opponent doesn't have yet
  if (!nextSet && !again) return { exists: true, all: true, user: who, clips: have, msg: `יש כבר את כל ${BOXER_SET.length} הסרטונים ל-${who} — לא מייצרים שוב. ▶ נגן` };
  boxer = nextSet ? nextSet.id : 'boxer1'; const setHe = (ALL_SETS.find(b => b.id === boxer) || BOXER_SET[0]).he; const setNo = BOXER_SET.findIndex(b => b.id === boxer) + 1; const BF = BODY_FX[boxer], LF = LION_FX[boxer];
  const job = { id: crypto.randomBytes(4).toString('hex'), kind: 'opponent', desc: '', he: '', user: cap?.user || user || '', boxer, status: 'מתחיל…', step: 0, cost: 0, t: Date.now(), imgs: {} }; genJobs.unshift(job); if (genJobs.length > 40) genJobs.pop(); genEmit();
  (async () => {
    try {
      if (!cap) { job.status = wait ? '🎯 מחכה שיסתכל למצלמה (עד דקה)…' : '📸 לוקח פריים מהשידור שלו…'; job.step = 1; genEmit(); try { cap = await oppCapture({ user, side, wait }); } catch (e) { const sv = savedHead(who); if (!sv) throw e; cap = sv; job.status = '💾 לא בלייב — משתמש בפנים השמורות שלו'; genEmit(); } job.user = cap.user; }
      job.he = (BF || LF) ? `${setHe} ל-${cap.user}` : `${setHe} ל-${cap.user} (${Math.min(setNo, BOXER_SET.length)}/${BOXER_SET.length})`; job.desc = job.he; job.imgs.frame = cap.boxed; job.imgs.head = cap.head; genEmit();
      if (!cap.face || cap.ok === false) throw new Error((cap.why || 'לא מצאתי פנים ברורות') + ' — לא חויבת. לחץ שוב כשהפנים מול המצלמה');
      if ((cap.faces || []).length > 1 && (cap.pick ?? -1) < 0 && !cap.verified) { job.needPick = true; throw new Error(`יש ${cap.faces.length} אנשים בלייב ולא זיהיתי את ${cap.user} לפי תמונת הפרופיל — לחץ על המספר של האדם הנכון ואז "ייצר מהתפיסה הזו". לא חויבת`); }
      if (!cap.greenPath) throw new Error('לא הצלחתי לחתוך את הגוף');
      if (!cap.saved) saveHead(cap);   // we're about to pay for this head — keep it, so the rest of his set can be made even after he leaves the live
      const id = ('ov_turk_vs_' + cap.user.replace(/[^\w]/g, '_') + '_' + Date.now().toString(36)).slice(0, 60);
      if (!preview) { const names = loadJ('overlays.json', {}); names[id] = { he: job.he, kind: 'clip', pos: BF?.pos || 'center', size: LF ? 1 : boxer === 'ov_baby' ? 0.5 : BF ? BF.size : 0.75, bottom: boxer === 'ov_baby' ? 0.3 : BF ? 0.02 : 0.0, user: cap.user, boxer, engine: LF ? 'google/veo-3.1-lite' : boxer === 'ov_baby' ? engines().video : (engines().boxer || 'runpod'), ...(LF ? { full: true } : {}) }; saveJ('overlays.json', names); }
      const E = engines();
      const pvDone = img => { previews.set(job.id, { still: img, user: cap.user, set: boxer, t: Date.now() }); if (previews.size > 60) previews.delete(previews.keys().next().value); job.preview = true; job.previewImg = '/media/rejected/' + path.basename(img); job.status = '👁 התצוגה המקדימה מוכנה'; job.step = 6; job.ready = true; genEmit(); };
      if (boxer === 'ov_baby' || BF || LF) {   // 👶/💃/🦁 Nano Banana draws HIM (his real face, blended — not pasted) as a crying baby / on a new body, an OpenRouter video engine moves it, then cut to transparent. (The pasted-head version was "ugly and not precise".)
        const k = pkey(cap.user), sp = P('data', 'heads', k + '.png'), sg = P('data', 'heads', k + '_green.jpg');
        // his REAL face from his live (the one you saw when you locked) — never mixed with a cartoon / someone else's profile picture (Tal's baby came out half Ron)
        const refs = fs.existsSync(sp) ? [sp, ...(fs.existsSync(sg) ? [sg] : [])] : [P('data', 'players', k + '.jpg'), P('data', 'avatars', k + '.jpg'), cap.headPath].filter((f, i, a) => f && fs.existsSync(f) && a.indexOf(f) === i).slice(0, 1);
        if (!refs.length) throw new Error('אין לי תמונה של הפנים שלו — לא חויבת');
        const reuse = still && fs.existsSync(still);   // the picture he already saw in the 👁 preview — not drawn (and paid) again
        const nb = reuse ? still : P('media', 'rejected', id + '_nb.png');
        if (!reuse) {
          job.status = (BF || LF) ? `🎨 Nano Banana מצייר אותו: ${setHe}…` : '🎨 Nano Banana מצייר אותו כתינוק בוכה…'; job.step = 2; genEmit();
          const imArgs = [P('tools', 'or_image.py'), nb, E.image, '--prompt=' + (LF ? LION_IMG(LF.scene) : BF ? (BF.img || BODY_IMG(BF.body)) : BABY_IMG_PROMPT), '--aspect=9:16', ...(LF ? [P('media', 'master.png')] : []), ...refs, ...(BF || LF ? [] : [P('data', 'baby_ref.jpg')])];   // the lion = image 1, then his face
          let im = await runPyJson(imArgs, 300000);
          if (im.error) { job.status = '🎨 עוד ניסיון אחד…'; genEmit(); im = await runPyJson(imArgs, 300000); }   // the image engine sometimes refuses once and draws on the 2nd try (Tal's first baby)
          if (im.error) throw new Error('התמונה לא יצאה: ' + String(im.error).slice(0, 160)); job.cost += +(im.cost || 0);
        }
        job.imgs.start = '/media/rejected/' + path.basename(nb);
        if (preview) return pvDone(nb);   // 👁 he looks first; the video is made only if he approves
        const vm = LF ? 'google/veo-3.1-lite' : BF ? (E.boxer && E.boxer !== 'runpod' ? E.boxer : E.video) : E.video;   // the lion scene = Veo (keeps the lion exact, full 720p); a moving body → the punch engine (Grok, no zoom); the baby keeps his engine
        const va = /grok/.test(vm) ? ['4', '480p'] : /veo/.test(vm) ? [LF && [6, 8].includes(+dur) ? String(+dur) : '4', '720p'] : /heygen/.test(vm) ? ['5', '768p'] : ['5', '720p'];
        job.status = `🎬 ${engineName(vm)} מזיז אותו…`; job.step = 3; genEmit();
        const v = await runPyJson([P('tools', 'or_video.py'), nb, id, vm, ...va, ...(/heygen/.test(vm) || E.audio ? ['--audio'] : []), '--aspect=9:16', '--prompt=' + (LF ? LION_VID(LF.move) : BF ? BODY_VID(BF.move) : BABY_VID_PROMPT)], 900000);
        if (v.error) throw new Error('הווידאו לא יצא: ' + String(v.error).slice(0, 160)); job.cost += +(v.cost || 0);
        job.status = LF ? '🎞 מכין למסך מלא…' : '✂️ חותך לשקוף…'; job.step = 4; genEmit();
        ovProcess(id, P('data', 'ovsrc', id + '.mp4'), !!LF); job.ovId = id; job.file = '/media/overlays/' + id + '.webm'; job.step = 5; genEmit();   // the lion scene stays a whole picture (keep) — it covers the camera for 4 seconds
        emit('status', { msg: `${LF ? '🦁' : BF ? '💃' : '👶'} ${job.he} — נוצר ($${job.cost.toFixed(2)})` }); return;
      }
      const viaOR = E.boxer && E.boxer !== 'runpod';
      if (preview) {   // 👁 the first frame of the punch clip, built locally — free
        job.status = '👁 בונה את תמונת הפתיחה…'; job.step = 2; genEmit();
        const d = await runPyJson([P('tools', 'gen_pair.py'), boxer, cap.greenPath, id, String(dur), ...(cap.headPath ? ['--head', cap.headPath] : []), ...(fullBody ? ['--full'] : []), '--dry'], 120000);
        if (d.error || !d.still) throw new Error(d.error || 'לא יצאה תמונה');
        return pvDone(d.still);
      }
      job.status = `🎬 ${viaOR ? engineName(E.boxer) : 'RunPod'} מייצר סט ${Math.min(setNo, BOXER_SET.length)}/${BOXER_SET.length}: ${setHe}…`; job.step = 2; genEmit();
      // the REAL part we captured, big, as he is in his live — no invented body (Shahak: "הכי טוב בלי הגוף"). fullBody only on request.
      const r = await runPyJson([P('tools', 'gen_pair.py'), boxer, cap.greenPath, id, String(dur), ...(cap.headPath ? ['--head', cap.headPath] : []), ...(fullBody ? ['--full'] : []), ...(viaOR ? ['--or=' + E.boxer] : [])], 900000);
      if (r.error) throw new Error(r.error);
      job.cost += +(r.cost || 0); job.imgs.start = '/media/rejected/' + path.basename(r.still); job.status = '✂️ הורד — חותך לשקוף…'; job.step = 4; genEmit();
      ovProcess(id, P('data', 'ovsrc', id + '.mp4'), false); job.ovId = id; job.file = '/media/overlays/' + id + '.webm'; job.step = 5; genEmit();
      emit('status', { msg: `🥊 ${job.he} — מוכן ($${job.cost.toFixed(2)})` });
    } catch (e) { job.status = 'נכשל: ' + e.message; job.error = e.message; genEmit(); emit('status', { msg: '🥊 נכשל: ' + e.message }); }
  })();
  return job;
}

// ---------- ⚙️ ENGINES — everything new goes through OpenRouter (Shahak, 2026-11-09: "only OpenRouter, cheap and strong"). Editable in /players → ⚙️ מנועים ----------
const ENG_DEF = { video: 'heygen/heygen-video-1', boxer: 'heygen/heygen-video-1', image: 'google/gemini-nano-banana-2.1', audio: false };   // he picked the 9-cent one
const engines = () => ({ ...ENG_DEF, ...loadJ('engines.json', {}) });
const engineName = id => ({ 'heygen/heygen-video-1': 'HeyGen', 'google/veo-3.1-lite': 'Veo 3.1 Lite', 'x-ai/grok-imagine-video-1.5-lite': 'Grok Lite', 'google/gemini-nano-banana-2.1': 'Nano Banana' })[id] || (String(id).split('/')[1] || id);
const ENG_TESTED = {   // measured on ronbiton11's baby, 2026-11-09
  'heygen/heygen-video-1': { usd: 0.09, secs: 19, he: 'הכי זול ומהיר · עם סאונד' },
  'google/veo-3.1-lite': { usd: 0.20, secs: 54, he: 'הכי מדויק בפנים · עם סאונד' },
  'x-ai/grok-imagine-video-1.5-lite': { usd: 0.16, secs: 32, he: 'הכי הרבה תנועה · בלי סאונד' },
  'google/gemini-nano-banana-2.1': { usd: 0.042, secs: 13, he: 'הפנים שלו נשמרות מצוין' },
};
const BABY_IMG_PROMPT = 'Create ONE photorealistic vertical 9:16 image. The first image(s) show the same real adult person (a TikTok streamer). The LAST image shows a chubby baby sitting on a green screen. Make that baby (same chubby body and sitting pose, dressed in a cute white baby onesie, whole body visible head to toe, centered) but give it the REAL HEAD AND FACE of that adult person: keep their exact identity - same face shape, eyes, nose, facial hair if any, skin tone, same hair or hat and the same glasses if they wear them - so anyone who knows them instantly recognizes them. The head is slightly big for the baby body, blended naturally at the neck with matching skin and lighting, like a real photo, not a paste. They are crying hard like a baby: eyes squeezed, eyebrows up, mouth wide open wailing, big tears on the cheeks. A playful, funny comedy image, never humiliating. Background: a perfectly flat, evenly lit, pure bright green chroma-key background (#00FF00), no floor, no shadows, no objects, no text, no watermark.';
const BABY_VID_PROMPT = "The chubby baby with the adult's head sitting on the flat green screen cries hard like a baby: the face scrunches, mouth wide open wailing, tears roll down, the baby kicks its little legs and waves its little arms, then sobs. Loud baby crying sound. Keep exactly the same face, hair or hat and glasses in every frame. The camera never moves or zooms: one wide static shot, the whole baby stays fully in frame, the flat bright green background stays unchanged, no other objects, no text.";
function estPrice(m) {   // a rough price of one short 9:16 clip, from OpenRouter's price list
  const d = m.supported_durations || []; const secs = d.includes(5) ? 5 : d.includes(4) ? 4 : (d[0] || 5);
  const rs = m.supported_resolutions || []; const res = ['720p', '768p', '480p', '1080p'].find(r => rs.includes(r)) || rs[0] || '';
  const p = m.pricing_skus || {}; const n = k => (p[k] != null ? +p[k] : null);
  let ps = n(`duration_seconds_with_audio_${res}`) ?? n(`duration_seconds_${res}`) ?? n(`image_to_video_duration_seconds_${res}`) ?? n('duration_seconds_with_audio') ?? n('duration_seconds');
  if (ps == null) { const c = n(`cents_per_video_output_second_${res}`) ?? n(`cents_per_second_output_${res}`) ?? n('cents_per_second_output'); if (c != null) ps = c / 100; }
  let usd = ps != null ? ps * secs : null;
  if (usd == null && n('video_tokens') != null) { const [w, h] = res === '480p' ? [854, 480] : res === '1080p' ? [1920, 1080] : [1280, 720]; usd = n('video_tokens') * (w * h * 24 * secs / 1024); }
  if (usd != null && n('cents_per_image_input') != null) usd += n('cents_per_image_input') / 100;
  return { secs, res, usd: usd == null ? null : Math.round(usd * 1000) / 1000 };
}
const orCache = { v: { t: 0, list: [] }, i: { t: 0, list: [] } };
async function orVideoModels() {
  if (Date.now() - orCache.v.t < 3600e3 && orCache.v.list.length) return orCache.v.list;
  const r = await fetch('https://openrouter.ai/api/v1/videos/models', { headers: { Authorization: 'Bearer ' + (settings.openrouterKey || '') }, signal: AbortSignal.timeout(20000) }); const j = await r.json();
  const list = (j.data || j || []).filter(m => (m.supported_frame_images || []).includes('first_frame') && (m.supported_aspect_ratios || []).includes('9:16')).map(m => ({ id: m.id, est: estPrice(m), durations: m.supported_durations || [], resolutions: m.supported_resolutions || [] })).sort((a, b) => (a.est.usd ?? 99) - (b.est.usd ?? 99));
  orCache.v = { t: Date.now(), list }; return list;
}
async function orImageModels() {
  if (Date.now() - orCache.i.t < 3600e3 && orCache.i.list.length) return orCache.i.list;
  const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20000) }); const j = await r.json();
  const list = (j.data || []).filter(m => (m.architecture?.output_modalities || []).includes('image') && (m.architecture?.input_modalities || []).includes('image') && !/^openrouter\//.test(m.id)).map(m => ({ id: m.id, out: +m.pricing?.completion || 0 })).sort((a, b) => a.out - b.out);
  orCache.i = { t: Date.now(), list }; return list;
}

// ---------- 👥 PLAYERS (public/players.html): everyone we made videos for + supporters — what each one has, make only what's missing ----------
// "effects" = the per-player set (BOXER_SET, his real head, RunPod) + the "with Chino" scenes (SCENES, Gemini). Anything added to either list shows up for everyone who doesn't have it yet.
function catalog() {
  const th = id => fs.existsSync(P('data', 'ovthumb_' + id + '.png')) ? '/data/ovthumb_' + id + '.png' : '';
  return { sets: ALL_SETS.filter(b => !b.lion).map(b => ({ id: b.id, he: b.he, kind: b.lion ? 'lion' : b.body ? 'body' : 'set', thumb: th(b.id) })), scenes: Object.entries(SCENES).map(([k, v]) => ({ id: k, he: v.he, kind: 'fun' })) };
}
const pkey = u => String(u || '').replace(/[^\w.]/g, '_');
function playerPhoto(user) { const k = pkey(user); for (const [d, f] of [['players', k + '.jpg'], ['avatars', k + '.jpg'], ['heads', k + '_green.jpg']]) if (fs.existsSync(P('data', d, f))) return '/data/' + d + '/' + f; return ''; }
function playersList() {
  const by = {}; const get = u => { const k = String(u || '').toLowerCase(); return by[k] || (by[k] = { user: String(u), clips: {}, fun: {}, roles: new Set(), last: 0 }); };
  const tOf = id => parseInt((String(id).match(/_([a-z0-9]{6,9})$/) || [])[1] || '0', 36) || 0;
  for (const [id, o] of Object.entries(loadJ('overlays.json', {}))) { if (!o || typeof o !== 'object' || o.kind !== 'clip' || !o.user || !fs.existsSync(P('media', 'overlays', id + '.webm'))) continue; const x = get(o.user); const s = o.boxer || 'boxer1'; (x.clips[s] = x.clips[s] || []).push({ id, t: tOf(id), engine: o.engine || '', chino: chinoTag(o) }); x.roles.add('opp'); x.last = Math.max(x.last, tOf(id)); }
  for (const it of fun) { if (!it.user) continue; const x = get(it.user); (x.fun[it.scene] = x.fun[it.scene] || []).push({ id: it.id, file: it.file || '', img: it.img || '', status: it.status || '', t: it.created || 0 }); x.last = Math.max(x.last, it.created || 0); }
  for (const [uid, v] of Object.entries(viewers)) if ((v.gifts || 0) > 0) { const x = get(uid); x.roles.add('fan'); x.nick = v.name; x.gifts = v.gifts; x.diamonds = v.diamonds || 0; x.last = Math.max(x.last, v.lastSeen || 0); }
  for (const a of loadJ('players.json', [])) { if (!a || !a.user) continue; const x = get(a.user); x.last = Math.max(x.last, a.t || 0); }
  for (const x of Object.values(by)) { for (const k in x.clips) x.clips[k].sort((a, b) => b.t - a.t); for (const k in x.fun) x.fun[k].sort((a, b) => b.t - a.t); }
  return Object.values(by).map(x => { const h = savedHead(x.user); return { user: x.user, nick: x.nick || '', photo: playerPhoto(x.user), head: h ? { t: h.t || 0, img: h.head } : null, clips: x.clips, fun: x.fun, roles: [...x.roles], gifts: x.gifts || 0, diamonds: x.diamonds || 0, last: x.last }; }).sort((a, b) => b.last - a.last);
}
async function toJpg(src, out, max = 1024) { const ff = await ffmpegPath(); await new Promise((res, rej) => execFile(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-frames:v', '1', '-vf', `scale='min(${max},iw)':-2`, '-q:v', '2', out], { windowsHide: true, timeout: 30000 }, e => e ? rej(e) : res())); return out; }
async function playerFace(user) {   // a photo of him for the "with Chino" videos: one you dropped → his TikTok picture → the head we caught from his live
  const k = pkey(user); for (const f of [P('data', 'players', k + '.jpg'), P('data', 'avatars', k + '.jpg'), P('data', 'heads', k + '_green.jpg')]) if (fs.existsSync(f)) return f;
  const v = viewers[user] || Object.entries(viewers).find(([id]) => id.toLowerCase() === String(user).toLowerCase())?.[1];
  if (v?.pic) { const f = await ownerAvatar(user, { avatar: v.pic }); if (f) return f; }
  try { const lv = await ttRoomVideo(user, ''); if (lv?.alive) { const f = await ownerAvatar(user, lv); if (f) return f; } } catch {}
  return '';
}
// 🚀 "launch to the live the moment it's ready": keys "user|setOrScene" (lowercase user)
const autoLaunch = new Set();
function autoLaunchEmit() { emit('autolaunch', { keys: [...autoLaunch] }); }
// 📡 "שגר לשרת": the chicken goes to Chino's engine (Codex's auto-host, 7780) — Chino grabs it by the comb with his paw and shows it in HIS output.
// It is NOT shown on our overlay at the same time. Every deliberate click = a new requestId; a retry after a failure = the same one (never fires twice by mistake).
const CHINO_URL = process.env.CHINO_URL || 'http://127.0.0.1:7780';
// Codex 2026-11-09 21:14: the dancers go as `dancer_side_dance` - the webm as is, NO handPoint and NO trackUrl; Chino places her beside the lion and the lion dances (doesn't touch her)
const DANCER_FX = { preset: 'dancer_side_dance', anchor: '', key: '', side: '', short: 'dancer' };
// Shahak 2026-11-09 21:40: the chicken should go as `chicken_blow` (the lion sees her, blows, she jumps away + crows) the moment Chino supports it - until then the lift-and-hold
const CHICKEN_HOLD = { preset: 'chicken_comb_hold', anchor: 'comb', key: 'grabPoint', side: '.grab.json', short: 'chicken' };
const CHICKEN_BLOW = { preset: 'chicken_blow', anchor: '', key: '', side: '', short: 'chicken' };
const BABY_FEED = { preset: 'baby_bottle_feed', anchor: 'mouth', key: 'feedPoint', side: '.feed.json', short: 'baby' };   // Shahak 21:45: no mother - Chino's lion gives the baby the bottle
const PLACED = (preset, short) => ({ preset, anchor: '', key: '', side: '', short });   // Chino decides where the character sits (shoulder / paw / armrest)
const CHINO_FX_BASE = { fx_chicken: CHICKEN_HOLD, fx_belly: DANCER_FX, fx_ballet: DANCER_FX, fx_bottle: BABY_FEED, fx_bow: PLACED('servant_bow', 'bow'), fx_tiny: PLACED('tiny_on_paw', 'tiny'), fx_fan: PLACED('servant_fan', 'fan'), fx_babyarm: PLACED('baby_in_arms', 'babyarm') };
const CHINO_FX = new Proxy(CHINO_FX_BASE, { get: (t, k) => k === 'fx_chicken' && CHINO_SUP?.has?.('chicken_blow') ? CHICKEN_BLOW : t[k] });
let CHINO_SUP = null;   // the presets Chino's engine knows right now: a tile shows 📡 only for what he can take
async function chinoPresets() { try { const r = await fetch(CHINO_URL + '/api/interactions', { signal: AbortSignal.timeout(5000) }); CHINO_SUP = new Set((await r.json()).supportedPresets || []); } catch {} }
chinoPresets(); setInterval(chinoPresets, 30000).unref?.();   // chicken first — the baby and the rest get connected one by one later
const CHINO_ERR = { chino_down: 'השרת של צ׳ינו (7780) לא עונה — הוא דולק?', unsupported_interaction_preset: 'צ׳ינו עוד לא מכיר את האפקט הזה', interaction_asset_alpha_required: 'הקובץ בלי שקיפות', interaction_asset_missing: 'צ׳ינו לא מצא את הקובץ', interaction_asset_changed: 'הקובץ השתנה באמצע — לחץ שוב', interaction_intake_busy: 'צ׳ינו עסוק — לחץ שוב עוד רגע', interaction_request_conflict: 'הבקשה הזאת כבר נשלחה עם נתונים אחרים — לחץ שוב', interaction_track_video_mismatch: 'קובץ המעקב לא מתאים לסרטון', interaction_store_write_failed: 'צ׳ינו לא הצליח לשמור — תגיד ל-Codex', interaction_store_invalid: 'צ׳ינו לא הצליח לשמור — תגיד ל-Codex', request_failed: 'שגיאה אצל צ׳ינו' };
function chinoTag(o) { const f = CHINO_FX[o?.boxer]; if (!f || (CHINO_SUP && !CHINO_SUP.has(f.preset))) return null; const l = o.chino?.last; return { preset: f.preset, sends: o.chino?.sends || 0, state: l?.state || '', rid: l?.requestId || '' }; }
// a sidecar made before the tracker file (tools/chino_anchor.py) was last changed is made again
function chinoAnchor(cid, f) {   // the comb in 0..1 of the file + a per-frame track next to the clip (tools/chino_anchor.py, ~6s once per clip)
  const side = P('media', 'overlays', cid + f.side);
  try { if (fs.statSync(side).mtimeMs >= Math.max(fs.statSync(P('media', 'overlays', cid + '.webm')).mtimeMs, fs.statSync(P('tools', 'chino_anchor.py')).mtimeMs)) { const pt = JSON.parse(fs.readFileSync(side, 'utf8'))[f.key]; if (pt) return Promise.resolve(pt); } } catch {}
  return new Promise(res => execFile('py', ['-3.13', P('tools', 'chino_anchor.py'), cid, f.anchor], { cwd: ROOT, windowsHide: true, timeout: 120000 }, (e, so) => { try { const j = JSON.parse(String(so).trim().split('\n').pop()); res(j.ok ? j.point : null); } catch { res(null); } }));
}
async function chinoPost(body) {   // retries keep the SAME requestId
  for (let i = 0; ; i++) {
    let j; try { const r = await fetch(CHINO_URL + '/api/interactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) }); j = await r.json().catch(() => ({ error: 'request_failed' })); } catch { j = { error: 'chino_down' }; }
    if (j.accepted || i >= 2 || !['chino_down', 'interaction_intake_busy', 'request_failed'].includes(j.error)) return j;
    await new Promise(r => setTimeout(r, 1200 * (i + 1)));
  }
}
// one at a time: while Chino is still showing a previous one, a new click is refused (a retry of the SAME request is fine). 2-minute cap so a stuck row never blocks forever.
const CHINO_BUSY = ['preparing_audio', 'queued', 'playing'];   // only what is really about to play / playing blocks the next one
async function chinoBusy(rid) {
  try { const r = await fetch(CHINO_URL + '/api/interactions', { signal: AbortSignal.timeout(8000) }); const rows = (await r.json()).requests || []; if (rows.some(x => x.requestId === rid)) return null; return rows.find(x => CHINO_BUSY.includes(x.state) && Date.now() - (x.createdAt || 0) < 120000) || null; } catch { return null; }
}
// 🖐️ the dancer hangs from her RAISED hand: the clip is cut to start when that hand goes up (the sound is cut the same way), then the hand is tracked in every frame
// (MediaPipe, local in tools/pose_venv — free, no server). The cut copy is <id>_h — Chino gets that one.
const CHINO_PY = () => P('tools', 'pose_venv', 'Scripts', 'python.exe');
function runP(cmd, args, opts = {}) { return new Promise((res, rej) => execFile(cmd, args, { cwd: ROOT, windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024, ...opts }, (e, so, se) => e ? rej(new Error(String(se || e.message).slice(-200))) : res(String(so)))); }
const chinoDancerBusy = new Map();
function chinoDancerPrep(cid) { if (!chinoDancerBusy.has(cid)) chinoDancerBusy.set(cid, chinoDancerPrep1(cid).finally(() => chinoDancerBusy.delete(cid))); return chinoDancerBusy.get(cid); }
async function chinoDancerPrep1(cid) {
  const ff = await ffmpegPath(), env = { ...process.env, FFMPEG_EXE: ff }, id2 = cid + '_h';
  const webm = P('media', 'overlays', cid + '.webm'), out = P('media', 'overlays', id2 + '.webm'), hj = P('media', 'overlays', id2 + '.hand.json'), mp4 = P('data', 'ovsrc', cid + '.mp4'), out4 = P('data', 'ovsrc', id2 + '.mp4');
  const fresh = () => { try { const t = fs.statSync(webm).mtimeMs; return fs.statSync(hj).mtimeMs >= t && fs.statSync(out).mtimeMs >= t; } catch { return false; } };
  if (!fresh()) {
    const py = CHINO_PY(); if (!fs.existsSync(py)) throw new Error('כלי זיהוי היד לא מותקן');
    const j1 = JSON.parse((await runP(py, [P('tools', 'pose_hand.py'), cid], { env })).trim().split('\n').pop());
    if (!j1.ok) throw new Error('לא מצאתי יד מורמת אצל הרקדנית (' + j1.why + ')');
    const full = JSON.parse(fs.readFileSync(P('media', 'overlays', cid + '.hand.json'), 'utf8')), fps = full.fps || 24, n = full.frames;
    const k = Math.max(0, Math.round(j1.graspAt * fps) - 3), ss = (k / fps).toFixed(3), len = ((n - k) / fps).toFixed(3);
    await runP(ff, ['-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-ss', ss, '-i', webm, '-t', len, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '3000k', '-auto-alt-ref', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-metadata:s:v:0', 'alpha_mode=1', '-an', out + '.tmp.webm']);
    fs.renameSync(out + '.tmp.webm', out);
    if (fs.existsSync(mp4)) { await runP(ff, ['-v', 'error', '-y', '-ss', ss, '-i', mp4, '-t', len, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', out4 + '.tmp.mp4']); fs.renameSync(out4 + '.tmp.mp4', out4); }
    const j2 = JSON.parse((await runP(py, [P('tools', 'pose_hand.py'), id2], { env })).trim().split('\n').pop());
    if (!j2.ok) throw new Error('לא הצלחתי לעקוב אחרי היד (' + j2.why + ')');
  }
  return { id: id2, point: JSON.parse(fs.readFileSync(hj, 'utf8')).handPoint };
}
async function chinoSend(cid, user, click, dry) {
  if (!user) throw new Error('בחר שחקן בפאנל קודם');
  const o = loadJ('overlays.json', {})[cid]; if (!o || o.kind !== 'clip' || !fs.existsSync(P('media', 'overlays', cid + '.webm'))) throw new Error('אין קליפ כזה');
  if (String(o.user).toLowerCase() !== String(user).toLowerCase()) throw new Error('הקליפ הזה לא של @' + user);
  const f = CHINO_FX[o.boxer]; if (!f) throw new Error('צ׳ינו עוד לא משחק עם האפקט הזה — כרגע רק תרנגולת');
  let prep = null; if (f.anchor === 'hand') { try { prep = await chinoDancerPrep(cid); } catch (e) { throw new Error(e.message || 'לא הצלחתי למצוא את היד של הרקדנית'); } }
  const aid = prep ? prep.id : cid, pt = prep ? prep.point : f.anchor ? await chinoAnchor(cid, f) : null;   // no anchor kind = send the clip as is (dancer_side_dance)
  const suf = (cid.match(/_([a-z0-9]{6,9})$/) || [])[1] || 'x', tok = String(click || '').replace(/[^\w]/g, '').slice(0, 16) || Date.now().toString(36);
  const body = { requestId: `${f.short}-${String(o.user).replace(/[^\w.-]/g, '_')}-${suf}-${tok}`.slice(0, 128), preset: f.preset, participant: { id: String(o.user) }, asset: { url: '/media/overlays/' + aid + '.webm', ...(pt ? { [f.key]: { x: +(+pt.x).toFixed(3), y: +(+pt.y).toFixed(3) } } : {}), ...(pt && fs.existsSync(P('media', 'overlays', aid + f.side)) ? { trackUrl: '/media/overlays/' + aid + f.side } : {}) } };
  if (dry) return { dry: true, body };
  const busy = await chinoBusy(body.requestId); if (busy) throw new Error('צ׳ינו עוד מציג את הקודמת (@' + (busy.participant?.id || '') + ') — חכה שיסיים ואז שלח');
  const j = await chinoPost(body);
  if (!j.accepted) throw new Error(CHINO_ERR[j.error] || ('צ׳ינו לא קיבל: ' + (j.error || 'שגיאה')));
  const names = loadJ('overlays.json', {});   // re-read right before writing, so a clip that finished meanwhile isn't lost
  if (names[cid]) { const c = names[cid].chino || {}, last = { requestId: j.requestId, id: j.id, state: j.state, t: Date.now() }; names[cid].chino = { sends: (c.sends || 0) + (j.idempotent ? 0 : 1), last, log: [...(c.log || []), last].slice(-20) }; saveJ('overlays.json', names); }
  return { ok: true, ...j, point: (f.key && body.asset[f.key]) || null, track: !!body.asset.trackUrl };
}
async function chinoState(rid) { try { const r = await fetch(CHINO_URL + '/api/interactions', { signal: AbortSignal.timeout(8000) }); const row = ((await r.json()).requests || []).find(x => x.requestId === rid); return row ? { state: row.state, rendered: !!row.rendered, reason: row.playback?.reason || '' } : { state: 'unknown' }; } catch { return { error: CHINO_ERR.chino_down }; } }
// what is on the live right now, in words — for Chino (the auto-host on 7780) and anyone listening on /api/events: {type:'overlay', info:{user, set, he, kind, full, secs}}
function clipInfo(cid, nm, track) { const s = ALL_SETS.find(b => b.id === nm?.boxer); return { id: cid, user: nm?.user || '', set: nm?.boxer || '', he: s?.he || nm?.he || '', kind: s?.lion ? 'lion' : s?.body ? 'body' : nm?.boxer === 'ov_baby' ? 'baby' : 'punch', full: !!track?.full, secs: track?.n && track?.fps ? Math.round(track.n / track.fps * 10) / 10 : null, t: Date.now() }; }
function launchClip(cid) {   // same as /api/overlay/play for a finished per-player clip (no head swap, no hit — the character already does it)
  const j = P('media', 'overlays', cid + '.json'); if (!fs.existsSync(j)) return false;
  const track = JSON.parse(fs.readFileSync(j, 'utf8')); const names = loadJ('overlays.json', {}); const nm = typeof names[cid] === 'object' ? names[cid] : {}; const k = nm.face ?? 0; if (track.tracks && track.tracks[k]) track.frames = track.tracks[k];
  track.swap = false; track.pos = nm.pos || 'center'; track.size = +(nm.size || 0.56); track.bottom = +(nm.bottom ?? 0.01); track.head = +(nm.head ?? 1); track.attach = ''; track.hitAt = null; track.dir = 1;
  emit('overlay', { id: cid, loop: false, webm: '/media/overlays/' + cid + '.webm', track, info: clipInfo(cid, nm, track) }); return true;
}

// ---------- 🍅 THE HEAD GAME: the opponent's real head on our stage; every like throws something at it ----------
let headGame = { on: false, user: '', still: '', likes: true, fxId: '', x: 0.5, y: 0.70, size: 0.46, thrown: 0, mode: 'face', showHead: false };
function headGameEmit() { emit('headgame', { on: headGame.on, user: headGame.user, still: headGame.still, face: headGame.face || null, mode: headGame.mode, showHead: headGame.showHead, x: headGame.x, y: headGame.y, size: headGame.size, likes: headGame.likes, fxId: headGame.fxId, thrown: headGame.thrown }); }
function tomatoFx() { return fx.find(f => f.id === headGame.fxId) || fx.find(f => /עגבני|tomato/i.test(f.name || '')) || fx[0]; }
async function headGameOn(user) {
  user = HANDLE(user); if (!user) throw new Error('כתוב שם משתמש');
  // his real head: live from his stream (hidden) when it plays, otherwise the clean capture we already have
  let cap = oppCaps.find(c => c.user === user && c.headPath && ((c.pick ?? -1) >= 0 || c.verified)) || oppCaps.find(c => c.user === user && c.headPath && (c.faces || []).length <= 1) || null;   // the person we PICKED (or verified), never a random big face
  if (!cap) { try { const c2 = await oppCapture({ user, wait: false }); if (c2.head && (c2.verified || (c2.faces || []).length <= 1)) cap = c2; } catch (e) { console.log('[game capture]', e.message); } }
  let still = cap ? cap.head : '';
  const face = cap && cap.face ? { x: cap.face[0] / 720, y: cap.face[1] / 1280, w: cap.face[2] / 720, h: cap.face[3] / 1280, side: cap.side || '' } : null;
  try { if (!oppLive.on || oppLive.user !== user) { await oppScreenOn(user); } oppLive.show = false; oppLiveEmit(); } catch (e) { console.log('[game stream]', e.message); }
  if (!still && !oppLive.on) throw new Error(`${user} לא בלייב ואין לי ראש שמור שלו`);
  headGame = { ...headGame, on: true, user, still, face, thrown: 0 }; headGameEmit(); emit('status', { msg: `🍅 המשחק דלוק: הראש של ${user} על המסך` }); return headGame;
}
function headGameOff() { headGame.on = false; headGameEmit(); if (oppLive.on && !oppLive.show) oppScreenOff(); emit('status', { msg: '🍅 המשחק כבוי' }); }
let tomatoQueue = 0, tomatoTimer = null;
function throwTomato(n = 1, why = '') {   // one every ~350ms (playFx's own throttle), queue the rest, never more than 12 waiting
  if (!headGame.on) return;
  tomatoQueue = Math.min(12, tomatoQueue + n);
  if (tomatoTimer) return;
  tomatoTimer = setInterval(() => { if (tomatoQueue <= 0 || !headGame.on) { clearInterval(tomatoTimer); tomatoTimer = null; tomatoQueue = 0; return; } tomatoQueue--; headGame.thrown++; try { emit('tomatoface', { n: 1 }); } catch {} if (headGame.thrown % 10 === 0) headGameEmit(); }, 380);
}
// ---------- ENGINE BRIDGE (Codex's talking lion). Nothing here is assumed to exist yet — see ENGINE_CONTRACT.md ----------
let engine = { url: settings.engineUrl || '', online: false, state: 'unknown', auto: null, info: null, lastOk: 0, lastErr: '' };
// route map — defaults match Codex's performer server as it stands today (port 7778); Codex can change any of these via settings.engineMap
const EMAP = { health: '/api/status', say: '/api/say', stop: '/api/stop', mode: '/api/mode', clip: '/api/clip', scene: '/api/scene', event: '/api/event', mute: '/api/mute', camera: '/api/scene', ...(settings.engineMap || {}) };
function engineStatus() { return { url: engine.url, online: engine.online, state: engine.state, auto: engine.auto, info: engine.info, lastErr: engine.lastErr }; }
async function engineCall(pth, body, method = 'POST') {
  if (!engine.url) throw new Error('כתובת המנוע של Codex לא הוגדרה');
  const r = await fetch(engine.url.replace(/\/$/, '') + pth, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j?.error || ('engine ' + r.status)); return j || {};
}
function engineEvent(type, data = {}) {
  if (!engine.online) return;
  // a clip with sound starts/ends → the performer must hold its voice (Codex: POST /api/clip {playing}); anything else → generic /event
  const call = type === 'video_start' ? engineCall(EMAP.clip, { playing: true, ...data }) : type === 'video_end' ? engineCall(EMAP.clip, { playing: false, ...data }) : engineCall(EMAP.event, { type, t: Date.now(), ...data });
  call.catch(e => { engine.lastErr = e.message; });
}
async function engineSay(text, opts = {}) {
  if (deskMuted) return { muted: true };
  pushConvo('ariel', text); emit('status', { msg: `🦁 (3D) אומר: "${text}"` });
  const lang = /[\u0590-\u05FF]/.test(text) ? 'he' : 'en';
  return engineCall(EMAP.say, { text, language: lang, lang, priority: !!opts.priority, emotion: opts.emotion || '', source: opts.source || 'dashboard' });
}
let lastProbe = 0;
async function enginePoll() {
  if (!engine.url) {
    if (engine.online) { engine.online = false; emit('engine', engineStatus()); }
    if (Date.now() - lastProbe > 30000) { lastProbe = Date.now(); try { const r = await fetch('http://127.0.0.1:7778' + EMAP.health, { signal: AbortSignal.timeout(1500) }); if (r.ok) { engine.url = 'http://127.0.0.1:7778'; settings.engineUrl = engine.url; saveJ('settings.json', settings); emit('status', { msg: '🧊 נמצא המנוע של Codex ב-127.0.0.1:7778' }); } } catch {} }
    if (!engine.url) return;
  }
  try { const j = await engineCall(EMAP.health, null, 'GET'); const was = engine.online; engine.online = true;
    const perf = j.performer || j; engine.state = j.state || perf.state || perf.mode || (perf.speaking ? 'speaking' : 'idle'); engine.auto = j.auto ?? (perf.mode ? /auto/i.test(String(perf.mode)) : engine.auto); engine.info = { mode: perf.mode, stage: j.stage, scene: j.scene, budget: j.budget, version: j.version }; engine.lastOk = Date.now(); engine.lastErr = '';
    if (j.render && j.render.url && (!set.render || set.render.auto)) { set.render = { ...j.render, auto: true }; saveJ('set.json', set); setEmit(); }
    if (!was) emit('status', { msg: '🟢 המנוע של Codex מחובר' });
  } catch (e) { const was = engine.online; engine.online = false; engine.lastErr = e.message; if (was) emit('status', { msg: '🔴 המנוע של Codex לא עונה' }); }
  emit('engine', engineStatus());
}
setInterval(() => enginePoll().catch(() => {}), 5000);

// ---------- CHINO DIRECTOR (Codex, port 7780): the conversation state the overlay shows — green "listening/speaking", orange "waiting for a clip", the time left comes from THEM ----------
const DIRECTOR = settings.directorUrl || 'http://127.0.0.1:7780';
let director = { online: false, conv: { active: false, state: '', secondsLeft: null }, queue: [], live: {}, stage: {}, externalClip: null, muted: null, target: null, camera: null, t: 0, lastErr: '' };
let directorLastJson = '';
async function dget(pth) { const r = await fetch(DIRECTOR + pth, { signal: AbortSignal.timeout(1500) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
async function directorPoll() {
  try {
    const [att, st] = await Promise.all([dget('/api/director/attention'), dget('/api/director/status')]);
    const c = att.conversation || {}; director = { ...director, online: true, conv: { active: !!c.active, state: String(c.state || ''), secondsLeft: c.secondsLeft ?? null }, queue: Array.isArray(att.queue) ? att.queue.slice(0, 8) : [], live: st.live || {}, stage: st.stage || {}, externalClip: st.externalClip ?? null, muted: st.muted ?? null, target: st.target ?? null, t: Date.now(), lastErr: '' };
    if (Date.now() - (director.camT || 0) > 10000) { try { director.camera = await dget('/api/virtual-camera'); } catch {} director.camT = Date.now(); }
  } catch (e) { const was = director.online; director.online = false; director.lastErr = e.message; if (was) emit('status', { msg: '🦁 המנהל של צ׳ינו (7780) לא עונה' }); }
  const pub = directorPublic(); const js = JSON.stringify(pub); if (js !== directorLastJson) { directorLastJson = js; emit('director', pub); }
}
function directorPublic() { return { online: director.online, conv: director.conv, queue: director.queue.map(q => typeof q === 'string' ? q : (q.name || q.nickname || q.user || q.uniqueId || '')).filter(Boolean), live: { active: !!director.live.active, audio: !!director.live.audioConnected }, stageReady: !!director.stage.ready, externalClip: director.externalClip, muted: director.muted, target: director.target, hint: settings.waitHint || 'כתבו שאלה בצ׳אט — צ׳ינו 🦁 עונה', t: director.t }; }
setInterval(() => directorPoll().catch(() => {}), 2000); setTimeout(() => directorPoll().catch(() => {}), 1500);

// ---------- THE DESK: what is active right now + the operator's interventions ----------
function deskState() {
  return { oppScreen: { on: oppLive.on, user: oppLive.user, status: oppLive.status, muted: oppLive.muted }, mode: set.mode, auto: !!(auto.on || convoSettings.autoReply), autoHost: !!auto.on, autoReply: !!convoSettings.autoReply, training: !!training.on, engine: engineStatus(), clip: clipPlaying, scene: scenes.find(x => x.id === set.scene)?.name || '', head: headState, opponent: opp.name || '', tiktok: { on: tt.on, user: tt.user, status: tt.status }, pending: pending.size, study: { on: sx.on, user: sx.user }, muted: !!deskMuted };
}
let deskMuted = false;
async function deskStop() {       // STOP EVERYTHING → manual: nothing queued may come back after the stop
  emit('stop', {}); clipEnded('stopped'); if (oppLive.on) oppScreenOff(); pending.clear(); pendingChat.length = 0; opponentPending = null; talkHold = 0;
  auto.on = false; saveJ('autolive.json', auto); convoSettings.autoReply = false; saveJ('convo_settings.json', convoSettings); autoEmit();
  if (engine.online) { await engineCall(EMAP.stop, { clear: true }).catch(() => {}); await engineCall(EMAP.mode, { mode: 'manual', auto: false }).catch(() => {}); }
  emit('desk', deskState()); emit('status', { msg: '⏹ נעצר הכל — מצב ידני' });
}
async function deskAuto(on) {
  auto.on = !!on; saveJ('autolive.json', auto); convoSettings.autoReply = !!on; saveJ('convo_settings.json', convoSettings); if (on) show.startedAt = show.startedAt || Date.now(); autoEmit();
  if (engine.online) await engineCall(EMAP.mode, { mode: on ? 'auto' : 'manual', auto: !!on }).catch(() => {});
  emit('desk', deskState()); emit('status', { msg: on ? '🤖 מצב אוטומטי — צ׳ינו מנהל' : '✋ מצב ידני' });
}
async function deskMute(on) {
  deskMuted = !!on; emit('mute', { on: deskMuted });
  if (engine.online) { await engineCall(EMAP.mute, { on: deskMuted }).catch(() => {}); if (deskMuted) await engineCall(EMAP.stop, { clear: false }).catch(() => {}); }
  emit('desk', deskState()); emit('status', { msg: deskMuted ? '🔇 האריה מושתק' : '🔊 האריה חזר לדבר' });
}
let talkHold = 0;
async function deskSay(text) {
  text = String(text || '').trim(); if (!text) throw new Error('אין טקסט');
  if (set.mode === '3d') { if (!engine.online) throw new Error('המנוע של Codex לא מחובר'); await engineSay(text, { priority: true, source: 'operator' }); return { engine: true }; }
  return say(text, { play: true });
}

const MIME = { '.flv': 'video/x-flv', '.mov': 'video/quicktime', '.webp': 'image/webp', '.gif': 'image/gif', '.webm': 'video/webm', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };
function sendFile(req, res, f, forceType) {
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('not found'); }
  const size = fs.statSync(f).size, type = forceType || MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
  if (/text\/html|javascript|manifest/.test(type)) res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');   // pages/scripts always fresh (phones + the tunnel cache aggressively)
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace('bytes=', '').split('-'); const start = +s, end = e ? +e : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return fs.createReadStream(f, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(f).pipe(res);
}
const readBody = req => new Promise((ok, no) => { const ch = []; req.on('data', c => ch.push(c)); req.on('end', () => ok(Buffer.concat(ch))); req.on('error', no); });
const json = (res, o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
const list = d => fs.readdirSync(P('media', d)).filter(f => f.endsWith('.mp4') && !/_try\d+\.mp4$/.test(f)).sort();

let rtc = { offer: null, answer: null, phoneIce: [], camIce: [], t: 0 };   // phone camera → cloud page (WebRTC)
// ---------- 📱 cloud box: render /cam (her camera + every effect) and push it into the cloud phone's camera (RTSP) ----------
let cloudCast = { on: false, state: 'off', target: '', frames: 0, error: '', since: 0 }; let cloudProc = null;
const tunnelUrl = () => { try { const m = fs.readFileSync('/opt/ariel-effects/tunnel.log', 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g); return m ? m[m.length - 1] : ''; } catch { return ''; } };
const cloudPub = () => ({ deskUrl: process.platform === 'win32' ? '' : (tunnelUrl() ? tunnelUrl() + '/fx?ak=' + settings.adminKey : ''), phoneUrl: process.platform === 'win32' ? '' : (tunnelUrl() ? tunnelUrl() + '/app?k=' + settings.clientKey : ''), on: cloudCast.on, state: cloudCast.state, target: cloudCast.target, frames: cloudCast.frames, error: cloudCast.error, since: cloudCast.since, linux: process.platform !== 'win32', rtsp: settings.cloudRtsp || '', phone: !!rtc.offer, phoneState: rtc.camState || '', phoneSide: rtc.phoneState2 || '' });
function cloudCastStart(o = {}) {
  if (cloudProc) return cloudPub();
  if (o.rtsp != null) { settings.cloudRtsp = String(o.rtsp || ''); saveJ('settings.json', settings); }
  const args = ['-3.13', '-u', P('tools', 'cam_to_rtsp.py'), '--url', `http://127.0.0.1:${PORT}/cam`];
  if (settings.cloudRtsp) args.push('--rtsp', settings.cloudRtsp); else if (o.path) args.push('--path', String(o.path));
  cloudCast = { on: true, state: 'starting', target: '', frames: 0, error: '', since: Date.now() };
  cloudProc = spawn('py', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = ''; cloudProc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); try { const j = JSON.parse(line); if (j.state && j.state !== 'tick') cloudCast.state = j.state; if (j.target) cloudCast.target = j.target; if (j.frames != null) cloudCast.frames = j.frames; if (j.error) cloudCast.error = j.error; emit('cloud', cloudPub()); } catch { console.log('[cloud]', line); } } });
  let err = ''; cloudProc.stderr.on('data', d => { err = (err + d).slice(-1500); });
  cloudProc.on('exit', code => { cloudProc = null; cloudCast.on = false; if (cloudCast.state !== 'stopped' && code) { cloudCast.state = 'error'; cloudCast.error = cloudCast.error || err.trim().split('\n').pop() || ('exit ' + code); } else cloudCast.state = 'off'; emit('cloud', cloudPub()); });
  emit('cloud', cloudPub()); return cloudPub();
}
// 📱 what the phone's camera actually shows (Codex's composed "live" path) → MJPEG for the desk (works through the SSH tunnel, unlike WebRTC)
const liveRtsp = () => { if (settings.cloudLiveRtsp) return settings.cloudLiveRtsp; try { return JSON.parse(fs.readFileSync('/var/lib/cloud-android/devices/phone1/boostera-live/config.json', 'utf8')).source_url || ''; } catch { return ''; } };
let phoneView = null; const phoneViewers = new Set();
async function phoneViewStart() {
  if (phoneView) return phoneView; const src = liveRtsp(); if (!src) throw new Error('אין כתובת למצלמה של הטלפון');
  const ff = await ffmpegPath();
  const pr = spawn(ff, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-rtsp_transport', 'tcp', '-i', src, '-an', '-vf', 'fps=10,scale=360:-2', '-q:v', '6', '-f', 'mpjpeg', '-boundary_tag', 'frame', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  pr.stdout.on('data', d => { for (const r of phoneViewers) { try { r.write(d); } catch {} } });
  pr.on('exit', () => { phoneView = null; for (const r of phoneViewers) { try { r.end(); } catch {} } phoneViewers.clear(); });
  phoneView = pr; return pr;
}
function cloudCastStop() { if (cloudProc) { try { cloudProc.kill('SIGTERM'); } catch {} setTimeout(() => { try { cloudProc && cloudProc.kill('SIGKILL'); } catch {} }, 4000); } cloudCast.on = false; cloudCast.state = 'off'; emit('cloud', cloudPub()); return cloudPub(); }
// ---------- 📱 the cloud phone INSIDE the app: live screen (MJPEG) + touch, so she operates TikTok there (LIVE button) ----------
const ADB = () => settings.adb || ['/usr/bin/adb', '-P', '5038', '-s', '127.0.0.1:6520'];
if (!settings.clientKey) { settings.clientKey = crypto.randomBytes(9).toString('base64url'); saveJ('settings.json', settings); }
if (!settings.adminKey) { settings.adminKey = crypto.randomBytes(12).toString('base64url'); saveJ('settings.json', settings); }
let screenLast = null, screenLoop = false; const screenViewers = new Set();
function screenPush() { if (!screenLast) return; const head = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${screenLast.length}\r\n\r\n`); for (const r of screenViewers) { try { r.write(head); r.write(screenLast); r.write('\r\n'); } catch {} } }
// screencap loop (~3 fps): simple and never stalls, unlike screenrecord which only sends changed frames
async function screenStart() {
  if (screenLoop) return; screenLoop = true; const ff = await ffmpegPath(); const [adb, ...a0] = ADB();
  (async () => { while (screenViewers.size) { const t = Date.now();
      try { const png = await new Promise(res => execFile(adb, [...a0, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 16 << 20, timeout: 6000 }, (e, out) => res(e ? null : out)));
        if (png && png.length > 1000) { const jpg = await new Promise(res => { const pr = execFile(ff, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'image2pipe', '-i', '-', '-vf', 'scale=360:-2', '-q:v', '7', '-f', 'mjpeg', '-'], { encoding: 'buffer', maxBuffer: 4 << 20, timeout: 6000 }, (e, out) => res(e ? null : out)); pr.stdin.end(png); });
          if (jpg && jpg.length > 500) { screenLast = jpg; screenPush(); } } } catch {}
      await new Promise(r => setTimeout(r, Math.max(60, 330 - (Date.now() - t)))); }
    screenLoop = false; })();
}
function screenStop() { /* the loop ends by itself when the last viewer leaves */ }
const adbRun = args => new Promise(res => { const [adb, ...a0] = ADB(); execFile(adb, [...a0, ...args], { timeout: 8000 }, (e, out) => res(e ? '' : String(out || ''))); });
const SCREEN = { w: 1080, h: 1920 };
// ---- 📺 the cloud phone's own screen stream (Cuttlefish WebRTC: 60fps video + direct touch) — proxied to the client app, key-gated ----
const CF = { host: '127.0.0.1', port: +(settings.cfOperatorPort || 1080) };
const cfDevice = () => settings.cfDevice || 'cvd_1-1-1';
const clientCookieOk = req => /(?:^|;\s*)bk=([\w-]+)/.exec(String(req.headers.cookie || ''))?.[1] === settings.clientKey;
const isCfPath = p => p === '/infra_config' || p.startsWith('/polled_connections') || p.startsWith('/devices/');
const CF_STYLE = `<style id="boostera">
html,body{margin:0;background:#000;overflow:hidden;height:100%}
#control-panel-default-buttons,#control-panel-custom-buttons,.display-control-buttons,#layout-toggle-button-container,.device-display-info,#device-details-modal,#delete{display:none!important}
#device-connection,#controls-and-displays,#device-display-column,#device-displays,.device-display,.device-video-container{width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;display:flex!important;align-items:center;justify-content:center;overflow:hidden}
.device-display-video{width:auto!important;height:100vh!important;max-width:100vw!important;max-height:100vh!important;object-fit:fill!important;touch-action:none;display:block}
@media (max-aspect-ratio: 9/20){.device-display-video{width:100vw!important;height:auto!important}}
#loader{border-color:#e6b450 transparent transparent transparent!important}
</style>`;
function cfProxy(req, res, p, u) {
  const opts = { host: CF.host, port: CF.port, method: req.method, path: u.pathname + u.search, headers: { ...req.headers, host: CF.host + ':' + CF.port } };
  delete opts.headers['accept-encoding'];
  const inject = /\/files\/client\.html$/.test(p);
  const pr = http.request(opts, r => {
    const h = { ...r.headers }; delete h['content-length']; delete h['content-security-policy']; delete h['x-frame-options'];
    if (/\/files\/.*\.(html|js|css)$/.test(p)) h['cache-control'] = 'no-store';
    if (!inject) { res.writeHead(r.statusCode, h); return r.pipe(res); }
    let body = ''; r.setEncoding('utf8'); r.on('data', d => body += d); r.on('end', () => { body = body.replace('</head>', CF_STYLE + '</head>'); res.writeHead(r.statusCode, h); res.end(body); });
  });
  pr.on('error', e => { try { res.writeHead(502); res.end('phone stream off: ' + e.message); } catch {} });
  req.pipe(pr);
}
function cfUpgrade(req, socket, head) {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  const pub = req.headers['cf-connecting-ip'] || /trycloudflare\.com$/i.test(String(req.headers.host || ''));
  if (!/^\/devices\/[^/]+\/connect$/.test(p) || (pub && !clientCookieOk(req))) { try { socket.destroy(); } catch {} return; }
  const up = http.request({ host: CF.host, port: CF.port, method: 'GET', path: u.pathname + u.search, headers: { ...req.headers, host: CF.host + ':' + CF.port } });
  up.on('upgrade', (r, s2, h2) => {
    let hdr = `HTTP/1.1 101 Switching Protocols\r\n`; for (const [k, v] of Object.entries(r.headers)) hdr += `${k}: ${v}\r\n`;
    socket.write(hdr + '\r\n'); if (h2?.length) socket.write(h2); if (head?.length) s2.write(head);
    s2.pipe(socket); socket.pipe(s2);
    s2.on('error', () => socket.destroy()); socket.on('error', () => s2.destroy());
  });
  up.on('response', () => socket.destroy()); up.on('error', () => socket.destroy());
  up.end();
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname);
  // a public link (her phone's HTTPS address) may only reach the phone page + its signalling — never the desk, never the keys
  if (req.headers['cf-connecting-ip'] || /trycloudflare\.com$/i.test(String(req.headers.host || ''))) { const adminOk = u.searchParams.get('ak') === settings.adminKey || /(?:^|;\s*)ak=([\w-]+)/.exec(String(req.headers.cookie || ''))?.[1] === settings.adminKey;
  if (adminOk && u.searchParams.get('ak')) { res.setHeader('Set-Cookie', 'ak=' + settings.adminKey + '; Path=/; Max-Age=31536000; SameSite=Lax; Secure'); }
  if (!(adminOk || (p.startsWith('/api/phone/') && (req.headers['x-key'] === settings.clientKey || u.searchParams.get('k') === settings.clientKey)) || (isCfPath(p) && clientCookieOk(req)) || p === '/phone' || p === '/client' || p === '/client.webmanifest' || p === '/app' || p === '/app/' || p.startsWith('/app/') || p.startsWith('/api/rtc/') || p.startsWith('/api/client/') || p.startsWith('/media/thumbs/'))) { res.writeHead(404); return res.end('not here'); } }
  if (isCfPath(p)) return cfProxy(req, res, p, u);
  try {
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('data: ' + JSON.stringify({ type: 'hello', boot: BOOT }) + '\n\n'); clients.add(res); req.on('close', () => clients.delete(res));
      try { res.write('data: ' + JSON.stringify({ type: 'director', ...directorPublic() }) + '\n\n'); } catch {}
      try { res.write('data: ' + JSON.stringify({ type: 'headgame', on: headGame.on, user: headGame.user, still: headGame.still, face: headGame.face || null, mode: headGame.mode, showHead: headGame.showHead, x: headGame.x, y: headGame.y, size: headGame.size, likes: headGame.likes, thrown: headGame.thrown }) + '\n\n'); } catch {}   // a page that opens later still knows the game is on
      try { res.write('data: ' + JSON.stringify({ type: 'cloud', ...cloudPub() }) + '\n\n'); } catch {}
      return;
    }
    if (req.method === 'POST' && p === '/api/head/snap') { const id = 'snap_' + Date.now(); fs.writeFileSync(P('data', id + '.jpg'), await readBody(req)); return json(res, { snap: id }); }
    if (req.method === 'POST' && p === '/api/fun') { const { snap, scenes, label } = JSON.parse(await readBody(req)); const f = P('data', String(snap).replace(/[^\w]/g, '') + '.jpg'); if (!fs.existsSync(f)) return json(res, { error: 'אין צילום' }, 400); for (const k of (scenes || [])) makeFun(f, k, label).catch(() => {}); return json(res, { ok: true }); }
    if (p === '/api/fun/list') return json(res, { scenes: Object.fromEntries(Object.entries(SCENES).map(([k, v]) => [k, v.he])), items: fun.slice(0, 40) });
    if (req.method === 'POST' && p === '/api/fun/play') { const { id } = JSON.parse(await readBody(req)); const it = fun.find(x => x.id === id); if (!it?.file) return json(res, { error: 'לא מוכן' }, 400); emit('play', { file: it.file, text: it.sceneHe, kind: 'fun' }); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/fun/delete') { const { id } = JSON.parse(await readBody(req)); fun = fun.filter(x => x.id !== id); saveJ('fun.json', fun); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/vcam') { vcam(!!JSON.parse(await readBody(req)).on); return json(res, { on: !!vcamProc }); }
    if (p === '/api/vcam') return json(res, { on: !!vcamProc });
    if (req.method === 'POST' && p === '/api/stage/open') { const b = JSON.parse((await readBody(req)).toString() || '{}'); openStageWindow(b.out || ''); return json(res, { ok: true }); }
    if (p === '/api/keys' && req.method === 'GET') return json(res, { gemini: !!KEY, spotify: !!spTok, spotifyUser: spTok?.user || '', openrouter: !!settings.openrouterKey, kling: !!(settings.klingKey || (settings.klingAccess && settings.klingSecret)), tiktools: !!settings.tiktoolsKey, tiktokUser: settings.tiktokUser || '', runpod: !!settings.runpodKey });
    if (req.method === 'POST' && p === '/api/keys') { const b = JSON.parse(await readBody(req)); for (const k of ['openrouterKey', 'klingKey', 'klingAccess', 'klingSecret', 'tiktoolsKey', 'tiktokUser', 'runpodKey']) if (typeof b[k] === 'string' && b[k].trim()) settings[k] = b[k].trim(); saveJ('settings.json', settings); return json(res, { ok: true }); }
    if (p === '/api/overlays') {
      const names = loadJ('overlays.json', {});
      const list = fs.readdirSync(P('media', 'overlays')).filter(f => f.endsWith('.webm') && fs.existsSync(P('media', 'overlays', f.replace(/\.webm$/, '.json')))).map(f => { const id = f.replace(/\.webm$/, ''); let meta = {}; try { meta = JSON.parse(fs.readFileSync(P('media', 'overlays', id + '.json'), 'utf8')); } catch {} const nm = names[id]; const o = typeof nm === 'object' ? nm : {}; return { id, he: (typeof nm === 'object' ? nm.he : nm) || id, face: o.face ?? 0, hitAt: o.hitAt ?? 1.2, pos: o.pos || 'left', size: o.size || 0.56, bottom: o.bottom ?? 0.01, head: o.head ?? 1, kind: o.kind || '', user: o.user || '', anchor: meta.anchor || 'face', faces: meta.faces || [], full: !!meta.full, n: meta.n, fps: meta.fps, secs: meta.n && meta.fps ? Math.round(meta.n / meta.fps * 10) / 10 : 0 }; });
      return json(res, { list, jobs: ovJobs });
    }
    if (req.method === 'POST' && p === '/api/chino/send') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); return json(res, await chinoSend(String(b.id || '').replace(/[^\w-]/g, ''), String(b.user || '').replace(/^@/, '').trim(), b.click, !!b.dry)); } catch (e) { return json(res, { error: e.message || 'שגיאה' }, 400); } }
    if (req.method === 'GET' && p === '/api/chino/state') return json(res, await chinoState(String(u.searchParams.get('rid') || '')));
    if (req.method === 'POST' && p === '/api/overlay/play') { const { id, loop, face, swap, pos, hitAt, dir, size, bottom, head, attach } = JSON.parse(await readBody(req)); const cid = String(id).replace(/[^\w-]/g, ''); const j = P('media', 'overlays', cid + '.json'); if (!fs.existsSync(j)) return json(res, { error: 'no overlay' }, 404); const track = JSON.parse(fs.readFileSync(j, 'utf8')); const names = loadJ('overlays.json', {}); const nm = typeof names[cid] === 'object' ? names[cid] : {}; const k = face != null ? +face : (nm.face ?? 0); if (track.tracks && track.tracks[k]) track.frames = track.tracks[k];
      // swap:false = the clip is a CHARACTER (a boxer…) — no head on it; at hitAt seconds his punch lands on the opponent's face
      if (nm.kind === 'clip' && swap == null) { /* a full character clip: no head, no hit */ } track.swap = swap !== false && nm.kind !== 'clip'; track.pos = pos || nm.pos || 'left'; track.size = +(size || nm.size || 0.56); track.bottom = +(bottom ?? nm.bottom ?? 0.01); track.head = +(head ?? nm.head ?? 1); track.attach = attach === 'face' ? 'face' : ''; track.hitAt = (swap === false && nm.kind !== 'clip') ? +(hitAt ?? nm.hitAt ?? 1.2) : null; track.dir = dir === 'left' ? -1 : 1;
      emit('overlay', { id: cid, loop: !!loop, webm: '/media/overlays/' + cid + '.webm', track, info: nm.kind === 'clip' ? clipInfo(cid, nm, track) : null }); return json(res, { ok: true, face: k }); }
    if (req.method === 'POST' && p === '/api/overlay/face') { const { id, face, he, hitAt, pos, size, bottom, head } = JSON.parse(await readBody(req)); const cid = String(id).replace(/[^\w-]/g, ''); const names = loadJ('overlays.json', {}); const cur = typeof names[cid] === 'object' ? names[cid] : { he: names[cid] || cid }; if (face != null) cur.face = +face; if (he) cur.he = String(he).slice(0, 40); if (hitAt != null) cur.hitAt = +hitAt; if (pos) cur.pos = pos; if (size) cur.size = +size; if (bottom != null) cur.bottom = +bottom; if (head != null) cur.head = +head; names[cid] = cur; saveJ('overlays.json', names); emit('overlays', {}); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/overlay/reprocess') { const { id, mode } = JSON.parse(await readBody(req)); const cid = String(id).replace(/[^\w-]/g, ''); const src = ['.mp4', '.webm', '.mov'].map(e => P('data', 'ovsrc', cid + e)).find(f => fs.existsSync(f)); if (!src) return json(res, { error: 'אין קובץ מקור' }, 404); ovProcess(cid, src, mode === 'keep'); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/overlay/delete') { const { id } = JSON.parse(await readBody(req)); const cid = String(id).replace(/[^\w-]/g, ''); for (const f of fs.readdirSync(P('media', 'overlays'))) if (f === cid + '.webm' || f === cid + '.json' || f.startsWith(cid + '_face')) { try { fs.unlinkSync(P('media', 'overlays', f)); } catch {} } emit('overlays', {}); return json(res, { ok: true }); }
    // upload a clip for a head swap → background processing (face tracks for everyone in it; optional cut-out)
    if (req.method === 'PUT' && p === '/api/overlay/upload') { try { const name = decodeURIComponent(u.searchParams.get('name') || 'clip.mp4'); const keep = u.searchParams.get('mode') !== 'cut'; const he = decodeURIComponent(u.searchParams.get('he') || ''); const buf = await readBody(req); const id = 'ov_' + SAFE(path.basename(name, path.extname(name))).replace(/[^\w-]/g, '_').slice(0, 30) + '_' + Date.now().toString(36); fs.mkdirSync(P('data', 'ovsrc'), { recursive: true }); const srcf = P('data', 'ovsrc', id + (path.extname(name) || '.mp4').toLowerCase()); fs.writeFileSync(srcf, buf); const names = loadJ('overlays.json', {}); names[id] = { he: he || path.basename(name, path.extname(name)).slice(0, 40), face: 0 }; saveJ('overlays.json', names); ovProcess(id, srcf, keep); return json(res, { ok: true, id }); } catch (e) { return json(res, { error: e.message }, 500); } }
    if (req.method === 'POST' && p === '/api/overlay/stop') { emit('overlayStop', {}); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/head/frame') { headFrame = await readBody(req); headTs = Date.now(); res.writeHead(204); return res.end(); }
    if (p === '/api/head/frame') { if (!headFrame) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store', 'X-Ts': String(headTs) }); return res.end(headFrame); }
    if (req.method === 'POST' && p === '/api/head/state') { Object.assign(headState, JSON.parse(await readBody(req))); emit('head', headState); return json(res, headState); }
    if (req.method === 'POST' && p === '/api/label') { Object.assign(labelState, JSON.parse(await readBody(req))); saveJ('label.json', labelState); emit('label', labelState); return json(res, labelState); }
    if (req.method === 'POST' && p === '/api/caps') { capsOn = !!JSON.parse(await readBody(req)).on; saveJ('caps.json', { on: capsOn }); emit('caps', { on: capsOn }); return json(res, { on: capsOn }); }
    if (p === '/api/state') return json(res, { head: headState, label: labelState, caps: capsOn, training,
      hasKey: !!KEY, idles: list('idle').map(f => '/media/idle/' + f),
      bank: [...bank].sort((a, b) => b.count - a.count || b.last - a.last), songs, busy: running + waiting.length, spotify, settings, playlistOn,
    });
    if (req.method === 'POST' && p === '/api/heard/audio') {
      // 6s of battle audio -> Hebrew transcript (opponent only; ignore the lion's own voice and music)
      const { b64 } = JSON.parse(await readBody(req)); res.writeHead(204); res.end();
      try {
        const r = await brain([{ inline_data: { mime_type: 'audio/webm', data: b64 } }, { text: 'This is 6 seconds of audio from a TikTok LIVE battle. Transcribe ONLY clearly spoken human speech, in Hebrew (or the language spoken). Ignore music, singing, sound effects and a very deep gravelly lion voice (that is us). If there is no clear speech, return {"text":""}. Return JSON: {"text": "the words", "speech": true/false}' }]);
        if (r && r.speech && r.text && r.text.trim().length > 1) onHeard(r.text.trim());
      } catch (e) { console.log('[heard]', e.message); }
      return;
    }
    if (req.method === 'POST' && p === '/api/heard') { const { text } = JSON.parse(await readBody(req)); onHeard(text); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/heard/reply') {   // operator pressed "reply to this" on a heard line
      const { text } = JSON.parse(await readBody(req));
      try { const d = await replyToOpponent(text); if (!d.line) return json(res, { error: 'no line' }, 400);
        const pid = crypto.randomBytes(4).toString('hex'); pending.set(pid, { input: text, ...d, res: '720p', play: true });
        emit('proposal', { pid, input: 'תגובה ל: ' + text, line: d.line, names: [], emotion: d.emotion }); return json(res, { ok: true }); }
      catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (req.method === 'POST' && p === '/api/song/redance') {
      const { id, all } = JSON.parse(await readBody(req));
      const targets = all ? songs.filter(x => (x.chorus || []).length) : songs.filter(x => x.id === id);
      for (const song of targets) (async () => {
        song.status = 'מייצר ריקודי פזמון חדשים…'; saveJ('songs.json', songs); emit('songs', {});
        const a = song.analysis || {};
        const outs = await Promise.allSettled([0, 1, 2].map(i => (async () => { const f = `${song.id}_sing${i + 1}_v2.mp4`; await generateChecked(singPrompt(a, i), P('media', 'dance', f), null, '720p', 'ריקוד פזמון'); return f; })()));
        const ok = outs.filter(o => o.status === 'fulfilled').map(o => o.value);
        if (ok.length) { for (const old of (song.sings || [])) { try { fs.renameSync(P('media', 'dance', old), P('media', 'rejected', old)); } catch {} } song.sings = ok; }
        song.status = ok.length ? 'למד ✓' : 'ריקוד נכשל'; saveJ('songs.json', songs); emit('songs', {}); emitSpotify();
      })().catch(() => {});
      return json(res, { ok: true, n: targets.length });
    }
    if (req.method === 'POST' && p === '/api/tiktok/connect') { try { const { user } = JSON.parse((await readBody(req)).toString() || '{}'); await ttConnect(user); return json(res, { ok: true, user: tt.user }); } catch (e) { tt.on = false; tt.status = 'שגיאה: ' + e.message; ttEmit(); return json(res, { error: e.message }, 400); } }
    if (req.method === 'POST' && p === '/api/tiktok/disconnect') { ttDisconnect(true); return json(res, { ok: true }); }
    if (p === '/api/tiktok') return json(res, { on: tt.on, user: tt.user || settings.tiktokUser || '', status: tt.status, seen: tt.seen, events: tt.lastEvt, viewers: Object.keys(viewers).length });
    if (req.method === 'POST' && p === '/api/study/start') { const { name } = JSON.parse((await readBody(req)).toString() || '{}'); studyStart(name); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/study/stop') { await studyStop(); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/study/frame') { const { jpg, audio } = JSON.parse(await readBody(req)); res.writeHead(204); res.end(); studyVision(jpg, audio); return; }
    if (p === '/api/moves') return json(res, moves);
    if(req.method==='GET' && p==='/api/learning/status')return json(res,{archive:evidence.status(),localTranscription:localASR?.status(),provider:providerState,observeOnly:training.observeOnly,queue:studyQueue.buf.length});
    if (req.method === 'POST' && p === '/api/study/audio') { const { b64 } = JSON.parse(await readBody(req)); res.writeHead(204); res.end(); studyChunk(b64); return; }
    if (req.method === 'POST' && p === '/api/training') { Object.assign(training, JSON.parse(await readBody(req))); saveJ('training.json', training); emit('trainingMode', training); return json(res, training); }
    if (p === '/api/training') return json(res, training);
    if (p === '/api/learnlog') return json(res, learnlog.slice(-200));
    if (req.method === 'POST' && p === '/api/learnlog/clear') { learnlog = []; saveJ('learnlog.json', learnlog); return json(res, { ok: true }); }
    if (p === '/api/study') return json(res, { on: study.on, name: study.name, chunks: study.chunks, recent: study.lines.slice(-30), lessons: study.lessons });
    // headless: listen to a streamer's live straight from TikTok's CDN — nothing plays on this PC
    if (p === '/api/stream') return json(res, { paused: Date.now() < brainPausedUntil ? brainPauseMsg : '', on: sx.on, user: sx.user, status: sx.status, chunks: sx.chunks, frames: sx.frames, live: !!sx.proc, title: sx.title, auto: stream.auto, opp: (watchers[sx.user] || {}).opp || '', interactions: (study.lessons.interactions || []).slice(-10) });
    if (req.method === 'POST' && p === '/api/stream/start') { const { user } = JSON.parse((await readBody(req)).toString() || '{}'); const u = String(user || stream.user || (follow.favorites || [])[0] || '').replace(/^@/, '').trim(); if (!u) return json(res, { error: 'חסר שם סטרימר' }, 400); stream = { auto: true, user: u }; saveJ('stream.json', stream); await sxStart(u); return json(res, { ok: true, user: u }); }
    // his music → our Spotify
    if (p === '/api/music') return json(res, { songs: music.songs.slice().sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 60), last: music.last });
    if (req.method === 'POST' && p === '/api/music/play') { try { const { title, artist, spotify: su } = JSON.parse(await readBody(req)); const uri = await spTrackUri(title, artist, su); await spApi('PUT', '/me/player/play', { uris: [uri] }); return json(res, { ok: true, uri }); } catch (e) { return json(res, { error: e.message }, 500); } }
    if (req.method === 'POST' && p === '/api/music/queue') { try { const { n } = JSON.parse((await readBody(req)).toString() || '{}'); let q = 0; for (const x of music.songs.slice().sort((a, b) => b.count - a.count).slice(0, n || 10)) { try { const uri = await spTrackUri(x.title, x.artist, x.spotify); await spApi('POST', '/me/player/queue?uri=' + encodeURIComponent(uri)); q++; } catch {} } return json(res, { ok: true, queued: q }); } catch (e) { return json(res, { error: e.message }, 500); } }
    if (req.method === 'POST' && p === '/api/music/playlist') { try { const me = await spApi('GET', '/me'); const name = `CHINO · learned from ${sx.user || stream.user || 'live'}`; const pl = await spApi('POST', `/users/${me.id}/playlists`, { name, public: false, description: 'what top TikTok battle streamers play — learned automatically by CHINO' }); const uris = []; for (const x of music.songs.slice().sort((a, b) => b.count - a.count).slice(0, 80)) { try { uris.push(await spTrackUri(x.title, x.artist, x.spotify)); } catch {} } for (let i = 0; i < uris.length; i += 100) await spApi('POST', `/playlists/${pl.id}/tracks`, { uris: uris.slice(i, i + 100) }); return json(res, { ok: true, name, n: uris.length, uri: pl.uri }); } catch (e) { return json(res, { error: /scope|Insufficient/i.test(e.message) ? 'צריך לחבר את ספוטיפיי מחדש (הרשאת פלייליסטים) — לחץ "התנתק" ואז "חבר חשבון"' : e.message }, 500); } }
    // the playbook: compiled knowledge → how CHINO runs a live
    if (p === '/api/playbook') return json(res, playbookSummary());
    if (p === '/api/playbook/full') return json(res, playbook);
    if (req.method === 'POST' && p === '/api/playbook/compile') { try { await compilePlaybook(true); return json(res, playbookSummary()); } catch (e) { return json(res, { error: e.message }, 500); } }
    if (req.method === 'POST' && p === '/api/playbook/warm') { const { n } = JSON.parse((await readBody(req)).toString() || '{}'); const made = await warmPlaybook(n || 12); return json(res, { ok: true, generating: made }); }
    if (req.method === 'POST' && p === '/api/stream/stop') { stream.auto = false; saveJ('stream.json', stream); await sxStop(true); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/study/warm') {   // turn learned lines into ready clips (the best N)
      const { n } = JSON.parse((await readBody(req)).toString() || '{}'); const pick = study.lessons.lines.slice(-(n || 10)).map(x => x.text);
      let made = 0; for (const l of pick) if (!bankHit(l, false)) { made++; generateLine(l, { line: l }, { play: false }).catch(() => {}); }
      return json(res, { ok: true, generating: made });
    }
    if (req.method === 'POST' && p === '/api/dept/watch') { const { users } = JSON.parse(await readBody(req)); for (const u of (users || [])) watchStart(u); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/dept/unwatch') { const { user } = JSON.parse(await readBody(req)); watchStop(user); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/dept/auto') {   // pick hot lives from tik.tools automatically
      try { const top = await (await fetch('https://api.tik.tools/api/live/top-channels')).json(); const { region, n } = JSON.parse((await readBody(req)).toString() || '{}');
        let list = (top.channels || []).filter(c => c.uniqueId && (!region || String(c.region || '').toUpperCase().startsWith(region.toUpperCase()))).sort((a, b) => (b.viewerCount || 0) - (a.viewerCount || 0)).slice(0, n || 3);
        if (!list.length && region) list = (top.channels || []).sort((a, b) => (b.viewerCount || 0) - (a.viewerCount || 0)).slice(0, n || 3);
        for (const c of list) watchStart(c.uniqueId); return json(res, { ok: true, picked: list.map(c => c.uniqueId) }); }
      catch (e) { return json(res, { error: e.message }, 500); }
    }
    if (req.method === 'POST' && p === '/api/dept/analyze') { await deptAnalyze(true); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/follow') { const b = JSON.parse(await readBody(req)); if (Array.isArray(b.favorites)) b.favorites = b.favorites.map(x => String(x).replace(/^@/, '').trim()).filter(Boolean); Object.assign(follow, b); saveJ('follow.json', follow); followTick().catch(() => {}); return json(res, follow); }
    if (p === '/api/follow') return json(res, { ...follow, hunted });
    if (p === '/api/dept') return json(res, { watching: Object.values(watchers).map(w => ({ user: w.user, status: w.status, stats: w.stats, evs: w.evs || {}, buf: w.buf.length })), knowledge });
    if (req.method === 'POST' && p === '/api/dept/warm') { const { n } = JSON.parse((await readBody(req)).toString() || '{}'); let made = 0; for (const x of knowledge.lines.slice(-(n || 10))) if (!bankHit(x.he, false)) { made++; generateLine(x.he, { line: x.he }, { play: false }).catch(() => {}); } return json(res, { ok: true, generating: made }); }
    if (req.method === 'POST' && p === '/api/autolive') { const wasOn = auto.on; Object.assign(auto, JSON.parse(await readBody(req))); if (auto.on && !wasOn) show.startedAt = Date.now(); saveJ('autolive.json', auto); autoEmit(); if (auto.on) { convoSettings.autoReply = true; saveJ('convo_settings.json', convoSettings); } return json(res, auto); }
    if (p === '/api/autolive') return json(res, auto);
    if (req.method === 'POST' && p === '/api/opponent') { Object.assign(opp, JSON.parse(await readBody(req))); saveJ('opponent.json', opp); emit('opponent', opp); return json(res, opp); }
    if (p === '/api/opponent') return json(res, { ...opp, templates: templates.slice().sort((a, b) => b.count - a.count).slice(0, 40) });
    if (p === '/api/convo') return json(res, { items: convo.slice(-60), settings: convoSettings });
    if (req.method === 'POST' && p === '/api/convo/warm') { const n = await warmQuick(); return json(res, { ok: true, generating: n }); }
    if (req.method === 'POST' && p === '/api/convo/settings') { Object.assign(convoSettings, JSON.parse(await readBody(req))); saveJ('convo_settings.json', convoSettings); return json(res, convoSettings); }
    if (req.method === 'POST' && p === '/api/convo/clear') { convo = []; saveJ('convo.json', convo); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/say') { const { text, res: q, rewrite } = JSON.parse(await readBody(req)); say(text, { res: q === '360p' ? '360p' : '720p', rewrite: rewrite !== false }).catch(e => emit('status', { msg: 'שגיאה: ' + e.message })); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/approve') {
      const { pid, line, asIs } = JSON.parse(await readBody(req)); const pr = pending.get(pid);
      if (!pr) return json(res, { error: 'expired' }, 404); pending.delete(pid);
      const d = { ...pr, line: asIs ? pr.input : (String(line || '').trim() || pr.line) };
      if (String(pr.input || '').startsWith('תגובה ל: ') || pr.reused !== undefined) pushConvo('ariel', d.line);
      if (bankHit(d.line, pr.play)) return json(res, { ok: true, cached: true });
      generateLine(pr.input, d, { play: pr.play, res: pr.res }).catch(e => emit('status', { msg: 'שגיאה: ' + e.message }));
      return json(res, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/reject') { const { pid } = JSON.parse(await readBody(req)); pending.delete(pid); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/warm') { const { lines } = JSON.parse(await readBody(req)); for (const l of lines) (bankHit(l, false) ? Promise.resolve() : generateLine(l, { line: l }, { play: false })).catch(e => emit('status', { msg: 'שגיאה: ' + e.message })); return json(res, { ok: true, n: lines.length }); }
    if (req.method === 'POST' && p === '/api/idle') { const { extra } = JSON.parse((await readBody(req)).toString() || '{}'); addIdle(extra).catch(e => emit('status', { msg: 'שגיאה: ' + e.message })); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/song/learn') { const name = decodeURIComponent(req.headers['x-name'] || 'song.mp3'); const buf = await readBody(req); learnSong(name, buf, req.headers['content-type']); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/song/play') { const { id } = JSON.parse(await readBody(req)); const s = songs.find(x => x.id === id); if (!s) return json(res, { error: 'no song' }, 404); if (!s.file) return json(res, { error: 'spotify song — play it in Spotify' }, 400); emit('song', songPayload(s)); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/playlist') { playlistOn = !!JSON.parse(await readBody(req)).on; emit('playlist', { on: playlistOn, songs: songs.filter(x => x.file && x.dances?.length).map(songPayload) }); return json(res, { on: playlistOn }); }
    if (req.method === 'POST' && p === '/api/log') { const { msg } = JSON.parse(await readBody(req)); stageLog.push(new Date().toLocaleTimeString() + ' ' + msg); if (stageLog.length > 200) stageLog.shift(); console.log('[stage]', msg); return json(res, { ok: true }); }
    if (p === '/api/logs') return json(res, stageLog.slice(-40));
    if (p === '/api/persona' && req.method === 'GET') return json(res, persona);
    if (req.method === 'POST' && p === '/api/persona') { persona = { text: JSON.parse(await readBody(req)).text }; saveJ('persona.json', persona); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/spotify/learn') { const r = startRec(); return json(res, r, r.error ? 400 : 200); }
    if (req.method === 'POST' && p === '/api/spotify/stoplearn') { stopRec(); return json(res, { ok: true }); }
    if (p === '/spotify/login') {
      if (!settings.spotifyClientId) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('חסר Client ID'); }
      spVerifier = b64url(crypto.randomBytes(48)); const ch = b64url(crypto.createHash('sha256').update(spVerifier).digest());
      const q = new URLSearchParams({ client_id: settings.spotifyClientId, response_type: 'code', redirect_uri: SP_REDIRECT, code_challenge_method: 'S256', code_challenge: ch, scope: SP_SCOPES });
      res.writeHead(302, { Location: 'https://accounts.spotify.com/authorize?' + q }); return res.end();
    }
    if (p === '/spotify/callback') {
      try { await spToken({ grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: SP_REDIRECT, client_id: settings.spotifyClientId, code_verifier: spVerifier }); const me = await spApi('GET', '/me'); spTok.user = me.display_name || me.id; spTok.product = me.product; saveJ('spotify_token.json', spTok); emit('spauth', { user: spTok.user });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(`<body dir=rtl style="background:#111;color:#f3d27a;font:700 26px system-ui;text-align:center;padding-top:20vh">✓ ספוטיפיי מחובר (${spTok.user})<br><span style="font-size:16px;color:#aaa">אפשר לסגור את החלון</span></body>`);
      } catch (e) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('שגיאה: ' + e.message); }
    }
    if (p === '/api/sp/status') return json(res, { clientId: !!settings.spotifyClientId, connected: !!spTok, user: spTok?.user, product: spTok?.product });
    if (req.method === 'POST' && p === '/api/sp/client') { settings.spotifyClientId = String(JSON.parse(await readBody(req)).id || '').trim(); saveJ('settings.json', settings); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/sp/logout') { spTok = null; try { fs.unlinkSync(P('data', 'spotify_token.json')); } catch {} return json(res, { ok: true }); }
    if (p === '/api/sp/playlists') { try { const j = await spApi('GET', '/me/playlists?limit=50'); return json(res, (j.items || []).filter(Boolean).map(x => ({ uri: x.uri, name: x.name, n: x.tracks?.total || x.items?.total }))); } catch (e) { return json(res, { error: e.message }, 400); } }
    if (req.method === 'POST' && p === '/api/sp/play') { try { const { uri } = JSON.parse(await readBody(req)); await spApi('PUT', '/me/player/play', uri ? { context_uri: uri } : undefined); setTimeout(pollSpotify, 800); return json(res, { ok: true }); } catch (e) { return json(res, { error: e.message }, 400); } }
    if (req.method === 'POST' && p === '/api/player') {
      const { cmd, vol } = JSON.parse(await readBody(req));
      if (['play', 'next', 'prev'].includes(cmd)) runPy([P('tools', 'media.py'), cmd]);
      if (cmd === 'vol') { duckLevel = Math.max(0, Math.min(1, +vol)); spVol = duckLevel; runPy([P('tools', 'duck.py'), String(duckLevel)]); }
      setTimeout(pollSpotify, 700); return json(res, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/duck') { duck(!!JSON.parse(await readBody(req)).on); return json(res, { ok: true }); }
    if (p === '/api/spotify') { emitSpotify(); return json(res, { spotify, settings }); }
    if (req.method === 'POST' && p === '/api/spotify/ctl') { try { const { action, volume } = JSON.parse((await readBody(req)).toString() || '{}');
      const devs = (await spApi('GET', '/me/player/devices'))?.devices || []; const dev = devs.find(d => d.is_active) || devs[0]; if (!dev) return json(res, { error: 'ספוטיפיי לא פתוח על אף מכשיר — פתח את Spotify במחשב' }, 400);
      const q = '?device_id=' + dev.id;
      if (action === 'play') await spApi('PUT', '/me/player/play' + q); else if (action === 'pause') await spApi('PUT', '/me/player/pause' + q); else if (action === 'next') await spApi('POST', '/me/player/next' + q);
      if (volume != null) await spApi('PUT', `/me/player/volume?volume_percent=${Math.max(0, Math.min(100, +volume))}&device_id=${dev.id}`);
      const st = await spApi('GET', '/me/player'); return json(res, { ok: true, device: dev.name, playing: !!st?.is_playing, track: st?.item?.name || '', artist: st?.item?.artists?.map(a => a.name).join(', ') || '', volume: st?.device?.volume_percent }); } catch (e) { return json(res, { error: e.message }, 500); } }
    if (req.method === 'POST' && p === '/api/settings') { Object.assign(settings, JSON.parse(await readBody(req))); saveJ('settings.json', settings); if (settings.learnPlaylist && spotify.playing && !rec) { const k = songByName(spotify.title); if (!k || !(k.chorus || []).length) startRec(); } emitSpotify(); return json(res, settings); }
    if (req.method === 'POST' && p === '/api/bank/delete') {
      const { id, all } = JSON.parse(await readBody(req));
      const gone = all ? bank : bank.filter(b => b.id === id);
      for (const b of gone) { try { fs.renameSync(P('media', 'bank', b.file), P('media', 'rejected', b.file)); } catch {} }
      bank = all ? [] : bank.filter(b => b.id !== id); saveJ('bank.json', bank); emit('bank', {}); return json(res, { ok: true, removed: gone.length });
    }
    if (p === '/api/bank/file') {
      const e = bank.find(b => b.id === u.searchParams.get('id')); if (!e) { res.writeHead(404); return res.end('not found'); }
      const f = P('media', 'bank', e.file), name = e.text.replace(/[\\/:*?"<>|]/g, '').slice(0, 60) + '.mp4';
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(f).size, 'Content-Disposition': `attachment; filename="ariel.mp4"; filename*=UTF-8''${encodeURIComponent(name)}` });
      return fs.createReadStream(f).pipe(res);
    }
    if (p === '/api/bank/zip') {
      const files = bank.map(b => ({ name: b.text.replace(/[\\/:*?"<>|]/g, '').slice(0, 60) + '.mp4', path: P('media', 'bank', b.file) })).filter(f => fs.existsSync(f.path));
      const zip = makeZip(files);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="ariel_sentences.zip"', 'Content-Length': zip.length }); return res.end(zip);
    }
    if (req.method === 'POST' && p === '/api/bank/clean') { cleanAll(); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/bank/rebuild') {
      // move every old clip away and regenerate the same lines, clean voice, no approval step
      const lines = [...new Set(bank.map(b => b.text))];
      for (const b of bank) { try { fs.renameSync(P('media', 'bank', b.file), P('media', 'rejected', 'old_' + b.file)); } catch {} }
      bank = []; saveJ('bank.json', bank); emit('bank', {});
      const extra = JSON.parse((await readBody(req)).toString() || '{}').lines || [];
      const all = [...new Set([...extra, ...lines])];
      for (const l of all) generateLine(l, { line: l }, { play: false }).catch(e => emit('status', { msg: 'שגיאה: ' + e.message }));
      return json(res, { ok: true, n: all.length });
    }
    if (req.method === 'POST' && p === '/api/stop') { emit('stop', {}); clipEnded('stopped'); return json(res, { ok: true }); }
    // ---- the set: layers, scenes, assets, clips, engine, desk ----
    if (req.method === 'GET' && p === '/api/set') return json(res, { set, assets, scenes, clips, engine: engineStatus(), clip: clipPlaying });
    if (req.method === 'POST' && p === '/api/set') { const b = JSON.parse((await readBody(req)).toString() || '{}'); const prevMode = set.mode; set = { ...set, ...b, frame: { ...set.frame, ...(b.frame || {}) } }; if (b.frame?.shot && engine.online) engineCall(EMAP.camera, { shot: b.frame.shot, framing: b.frame.shot === 'close' ? 'portrait' : 'seated' }).catch(() => {}); if (b.mode && b.mode !== prevMode) emit('status', { msg: b.mode === '3d' ? '🧊 מצב 3D — האריה של Codex; משפטים לא הולכים למנוע הווידאו' : b.mode === 'off' ? '🚫🦁 בלי אריה — המצלמה נושאת רק את מסך היריב והאפקטים' : '🎞 מצב וידאו — סרטוני האריה שלנו' }); saveJ('set.json', set); setEmit(); emit('desk', deskState()); return json(res, set); }
    if (req.method === 'POST' && p === '/api/scene/save') { const { name } = JSON.parse((await readBody(req)).toString() || '{}'); return json(res, saveScene(name)); }
    if (req.method === 'POST' && p === '/api/scene/apply') { try { const { id } = JSON.parse(await readBody(req)); return json(res, applyScene(id)); } catch (e) { return json(res, { error: e.message }, 404); } }
    if (req.method === 'POST' && p === '/api/scene/delete') { const { id } = JSON.parse(await readBody(req)); scenes = scenes.filter(x => x.id !== id); saveJ('scenes.json', scenes); emit('scenes', { scenes }); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/scene/rename') { const { id, name } = JSON.parse(await readBody(req)); const sc = scenes.find(x => x.id === id); if (sc) { sc.name = String(name || sc.name).slice(0, 40); saveJ('scenes.json', scenes); emit('scenes', { scenes }); } return json(res, { ok: true }); }
    if (req.method === 'PUT' && p === '/api/upload') { try { const kind = u.searchParams.get('kind'); if (!['bg', 'front', 'clips'].includes(kind)) return json(res, { error: 'kind' }, 400); const item = await addAsset(kind, decodeURIComponent(u.searchParams.get('name') || 'file'), await readBody(req)); return json(res, item); } catch (e) { return json(res, { error: e.message }, 500); } }
    if (req.method === 'POST' && p === '/api/asset/delete') { const { kind, id } = JSON.parse(await readBody(req)); return json(res, { ok: removeAsset(kind, id) }); }
    if (req.method === 'POST' && p === '/api/clip/play') { try { const { id } = JSON.parse(await readBody(req)); return json(res, playClip(id)); } catch (e) { return json(res, { error: e.message }, 404); } }
    if (req.method === 'POST' && p === '/api/clip/stop') { emit('clipStop', {}); clipEnded('stopped'); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/clip/ended') { clipEnded('ended'); res.writeHead(204); return res.end(); }
    if (req.method === 'POST' && p === '/api/clip/update') { const { id, ...rest } = JSON.parse(await readBody(req)); const c = clips.find(x => x.id === id); if (c) { for (const k of ['name', 'size']) if (rest[k] != null) c[k] = rest[k]; saveJ('clips.json', clips); emit('clips', { clips }); } return json(res, { ok: !!c }); }
    // ---- opponent screen + effects ----
    if (p.startsWith('/proxy/flv/')) return proxyFlv(req, res, p.slice('/proxy/flv/'.length));
    if (req.method === 'GET' && p === '/api/opp/screen') return json(res, { ...oppLive, url: undefined, src: oppLive.token ? '/proxy/flv/' + oppLive.token : '' });
    if (req.method === 'POST' && p === '/api/opp/screen') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); if (b.muted != null) { oppLive.muted = !!b.muted; oppLiveEmit(); } if (b.show != null) { oppLive.show = !!b.show; oppLiveEmit(); } if (b.view) { const pv = b.view.preset && OPP_VIEWS[b.view.preset] ? { preset: b.view.preset, ...OPP_VIEWS[b.view.preset] } : {}; oppLive.view = { ...oppLive.view, ...pv, ...Object.fromEntries(Object.entries(b.view).filter(([k, v]) => k !== 'preset' && v != null)) }; if (!pv.preset && (b.view.scale != null || b.view.x != null || b.view.y != null)) oppLive.view.preset = 'custom'; saveJ('oppview.json', oppLive.view); oppLiveEmit(); } if (b.on === false) oppScreenOff(); else if (b.on === true) await oppScreenOn(b.user); return json(res, { ...oppLive, url: undefined }); } catch (e) { return json(res, { error: e.message }, 500); } }
    if (p === '/api/fx') return json(res, { fx });
    if (req.method === 'GET' && p === '/api/gen') return json(res, { jobs: genJobs.slice(0, 20), runpod: !!settings.runpodKey, caps: oppCaps.slice(0, 6).map(pubCap), opponent: HANDLE(oppLive.user || opp.handle), have: Object.fromEntries(Object.entries(loadJ('overlays.json', {})).filter(([id, o]) => o && typeof o === 'object' && o.kind === 'clip' && o.user && fs.existsSync(P('media', 'overlays', id + '.webm'))).map(([id, o]) => [id, { user: o.user, he: o.he, boxer: o.boxer || 'boxer1' }])), sets: BOXER_SET.length });
    if (req.method === 'GET' && p === '/api/opp/roster') {   // everyone we already made videos for — pick them even when they're offline (the videos are ours, they play anytime)
      const names = loadJ('overlays.json', {}); const by = {};
      for (const [id, o] of Object.entries(names)) { if (!o || typeof o !== 'object' || o.kind !== 'clip' || !o.user || !fs.existsSync(P('media', 'overlays', id + '.webm'))) continue; const u = o.user; (by[u] = by[u] || { user: u, sets: new Set(), clips: 0, last: 0 }); by[u].clips++; by[u].sets.add(o.boxer || 'boxer1'); by[u].last = Math.max(by[u].last, parseInt((id.match(/_([a-z0-9]{6,9})$/) || [])[1] || '0', 36) || 0); }
      const list = Object.values(by).map(x => ({ user: x.user, clips: x.clips, sets: x.sets.size, total: BOXER_SET.length, last: x.last, saved: !!savedHead(x.user) })).sort((a, b) => b.last - a.last);
      const now = Date.now(); await Promise.all(list.map(async x => { const c = rosterAlive.get(x.user); if (c && now - c.t < 60000) { x.alive = c.alive; return; } try { const v = await ttRoomVideo(x.user, ''); x.alive = !!(v && v.alive && v.url); } catch { x.alive = false; } rosterAlive.set(x.user, { alive: x.alive, t: now }); }));
      return json(res, { list }); }
    if (req.method === 'GET' && p === '/api/opp/alive') { const user = HANDLE(u.searchParams.get('user')); if (!user) return json(res, { error: 'שם משתמש לא תקין' }, 400); try { const v = await ttRoomVideo(user, ''); const have = clipsOf(user); return json(res, { user, alive: !!(v && v.alive && v.url), title: v?.title || '', have: have.length, sets: BOXER_SET.length }); } catch (e) { return json(res, { user, alive: false, error: e.message }); } }
    if (req.method === 'GET' && p === '/api/director') return json(res, { ...directorPublic(), url: DIRECTOR, lastErr: director.lastErr });
    if (req.method === 'POST' && p === '/api/director/hint') { const b = JSON.parse((await readBody(req)).toString() || '{}'); settings.waitHint = String(b.hint || '').slice(0, 120); saveJ('settings.json', settings); directorLastJson = ''; return json(res, { ok: true }); }
    if (req.method === 'GET' && p === '/api/headgame') return json(res, { ...headGame, fx: tomatoFx() ? { id: tomatoFx().id, name: tomatoFx().name } : null });
    if (req.method === 'POST' && p === '/api/headgame') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); if (b.likes != null) headGame.likes = !!b.likes; if (b.fxId) headGame.fxId = String(b.fxId); if (b.mode) headGame.mode = 'face'; if (b.showHead != null) headGame.showHead = !!b.showHead; for (const k of ['x', 'y', 'size']) if (b[k] != null) headGame[k] = +b[k]; if (b.on === true) await headGameOn(b.user); else if (b.on === false) headGameOff(); else headGameEmit(); return json(res, headGame); } catch (e) { return json(res, { error: e.message }, 400); } }
    if (req.method === 'POST' && p === '/api/headgame/throw') { const b = JSON.parse((await readBody(req)).toString() || '{}'); throwTomato(Math.max(1, Math.min(10, +b.n || 1)), 'manual'); return json(res, { ok: true, queue: tomatoQueue }); }
    if (req.method === 'POST' && p === '/api/opp/pick') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); return json(res, pubCap(await oppPick(String(b.capId || ''), +b.pick || 0))); } catch (e) { return json(res, { error: e.message }, 400); } }
    if (req.method === 'POST' && p === '/api/opp/capture') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); return json(res, pubCap(await oppCapture({ user: b.user, side: ['left', 'right'].includes(b.side) ? b.side : '', wait: !!b.wait }))); } catch (e) { return json(res, { error: e.message }, 400); } }
    if (req.method === 'POST' && p === '/api/gen/opponent/all') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); const side = ['left', 'right'].includes(b.side) ? b.side : '';
      let cap = b.capId ? oppCaps.find(c => c.id === b.capId) : null; if (!cap) { try { cap = await oppCapture({ user: b.user, side, wait: b.wait !== false }); } catch (e) { const sv = savedHead(HANDLE(b.user)); if (!sv) throw e; cap = sv; } }
      if (!cap.face || cap.ok === false) return json(res, { error: (cap.why || 'לא מצאתי פנים ברורות') + ' — לא חויבת' }, 400);
      if ((cap.faces || []).length > 1 && (cap.pick ?? -1) < 0 && !cap.verified) return json(res, { error: `יש ${cap.faces.length} אנשים בלייב ולא זיהיתי את ${cap.user} לפי תמונת הפרופיל — לחץ על המספר של האדם הנכון ואז "כל 3 הסטים". לא חויבת`, cap: pubCap(cap) }, 400);
      const have = clipsOf(cap.user); const missing = BOXER_SET.filter(bs => !have.some(c => c.boxer === bs.id)); if (!missing.length) return json(res, { exists: true, all: true, user: cap.user, clips: have, msg: `יש כבר את כל ${BOXER_SET.length} הסטים ל-${cap.user}` });
      const jobs = []; for (const bs of missing) jobs.push(await opponentPunch({ capId: cap.id, set: bs.id, dur: [5, 8].includes(+b.dur) ? +b.dur : 5 }));
      return json(res, { ok: true, user: cap.user, started: jobs.length, jobs }); } catch (e) { return json(res, { error: e.message }, 400); } }
    if (req.method === 'POST' && p === '/api/gen/opponent') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); return json(res, await opponentPunch({ capId: b.capId, user: b.user, side: ['left', 'right'].includes(b.side) ? b.side : '', dur: [5, 8].includes(+b.dur) ? +b.dur : 5, again: !!b.again, wait: b.wait !== false })); } catch (e) { return json(res, { error: e.message }, 400); } }
    if (req.method === 'POST' && p === '/api/gen') { try { const b = JSON.parse(await readBody(req)); if (!String(b.desc || '').trim() && !b.fromOverlay) return json(res, { error: 'תאר את הדמות' }, 400); return json(res, await createCharacter({ desc: String(b.desc || '').trim(), kind: b.kind || 'character', dur: [5, 8, 10].includes(+b.dur) ? +b.dur : 5, he: String(b.he || '').trim(), motion: String(b.motion || '').trim(), fromOverlay: String(b.fromOverlay || '').replace(/[^\w-]/g, '') })); } catch (e) { return json(res, { error: e.message }, 500); } }
    // live face position from the operator's camera (detected in the dashboard) → the overlay in Live Studio aims effects by it
    if (req.method === 'POST' && p === '/api/face') { const b = JSON.parse((await readBody(req)).toString() || '{}'); faceRemote = { x: +b.x, y: +b.y, s: +b.s, vw: +b.vw || 0, vh: +b.vh || 0, mirror: !!b.mirror, on: b.on !== false, t: Date.now() }; if (Date.now() - lastFaceEmit > 45) { lastFaceEmit = Date.now(); emit('face', faceRemote); } res.writeHead(204); return res.end(); }
    if (p === '/api/face') return json(res, faceRemote || {});
    if (req.method === 'POST' && p === '/api/hit') { const { dir, power } = JSON.parse((await readBody(req)).toString() || '{}'); emit('hit', { dir: dir === 'left' ? -1 : dir === 'right' ? 1 : (+dir || 1), power: +power || 1 }); return json(res, { ok: true }); }
    if (req.method === 'PUT' && p === '/api/fx/upload') { try { return json(res, await addFx(decodeURIComponent(u.searchParams.get('name') || 'fx.webm'), await readBody(req))); } catch (e) { return json(res, { error: e.message }, 500); } }
    if (req.method === 'POST' && p === '/api/fx/play') { try { const { id, aim, flip, scale } = JSON.parse(await readBody(req)); return json(res, playFx(id, { aim, flip, scale })); } catch (e) { return json(res, { error: e.message }, 404); } }
    if (req.method === 'POST' && p === '/api/fx/delete') { const { id } = JSON.parse(await readBody(req)); const i = fx.findIndex(x => x.id === id); if (i >= 0) { const it = fx.splice(i, 1)[0]; for (const f of [it.file, it.thumb]) if (f) { try { fs.unlinkSync(P(f.slice(1))); } catch {} } saveJ('fx.json', fx); fxEmit(); } return json(res, { ok: i >= 0 }); }
    if (req.method === 'POST' && p === '/api/fx/update') { const b = JSON.parse(await readBody(req)); const { id, name, aim, impact, fit, scale } = b; const f = fx.find(x => x.id === id); if (f) { if (name) f.name = String(name).slice(0, 60); if (aim) f.aim = aim === 'full' ? 'full' : 'face'; if (b.hitAt != null) f.hitAt = +b.hitAt; if (b.hit != null) f.hit = !!b.hit; if (b.power) f.power = +b.power; if (impact && impact.x != null) f.impact = { x: +impact.x, y: +impact.y }; if (fit != null) f.fit = !!fit; if (scale) f.scale = +scale; saveJ('fx.json', fx); fxEmit(); } return json(res, { ok: !!f }); }
    if (req.method === 'GET' && p === '/api/engine') return json(res, engineStatus());
    if (req.method === 'POST' && p === '/api/engine') { const { url } = JSON.parse(await readBody(req)); engine.url = String(url || '').trim(); settings.engineUrl = engine.url; saveJ('settings.json', settings); await enginePoll(); return json(res, engineStatus()); }
    if (req.method === 'POST' && p === '/api/engine/call') { try { const { path: ep, body, method } = JSON.parse(await readBody(req)); if (!/^\/[\w\-\/]*$/.test(String(ep))) return json(res, { error: 'path' }, 400); return json(res, await engineCall(ep, body, method || 'POST')); } catch (e) { return json(res, { error: e.message }, 500); } }
    if (p === '/api/desk') return json(res, deskState());
    if (req.method === 'POST' && p === '/api/desk/stop') { await deskStop(); return json(res, deskState()); }
    if (req.method === 'POST' && p === '/api/desk/auto') { const { on } = JSON.parse(await readBody(req)); await deskAuto(!!on); return json(res, deskState()); }
    if (req.method === 'POST' && p === '/api/desk/mute') { const { on } = JSON.parse(await readBody(req)); await deskMute(on == null ? !deskMuted : !!on); return json(res, deskState()); }
    if (req.method === 'POST' && p === '/api/desk/say') { try { const { text } = JSON.parse(await readBody(req)); return json(res, await deskSay(text)); } catch (e) { return json(res, { error: e.message }, 500); } }
    if (req.method === 'POST' && p === '/api/replay') { const { id } = JSON.parse(await readBody(req)); const e = bank.find(b => b.id === id); if (e) { e.count++; e.last = Date.now(); saveJ('bank.json', bank); emit('play', { file: '/media/bank/' + e.file, text: e.text, kind: 'talk' }); emit('bank', {}); } return json(res, { ok: !!e }); }
    // ---- 🦁 switch cloud camera source (camera / lion) ----
    if (p === '/api/cloud/source') { if (req.method === 'POST') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); settings.cloudSource = (b.source === 'lion') ? 'lion' : 'camera'; saveJ('settings.json', settings); emit('cloud', cloudPub()); return json(res, { ok: true, source: settings.cloudSource }); } catch (e) { return json(res, { error: e.message }, 400); } } return json(res, { source: settings.cloudSource || 'camera' }); }
    // ---- 🦁 trigger an action on the lion (dance/song/roar) ----
    if (req.method === 'POST' && p === '/api/chino/action') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); emit('chino', { action: b.action }); return json(res, { ok: true, action: b.action }); } catch (e) { return json(res, { error: e.message }, 400); } }
    // ---- ⭐ top supporters in the live (simple snapshot: last gifters / viewers if we have them) ----
    if (req.method === 'GET' && p === '/api/live/top') { const top = (deskState().top || []).slice(0, 10).map(t => ({ user: t.user || t.handle || '', gift: +t.gift || +t.coins || 0 })); return json(res, { top }); }
    // ---- 💖 SUPPORTERS dashboard — pre-live prep of VIP fans ----
    if (p === '/supporters') return sendFile(req, res, P('public', 'supporters.html'));
    // ---- 👥 PLAYERS console (/players): who has what, make only what's missing, progress, launch / auto-launch ----
    if (p === '/players') return sendFile(req, res, P('public', 'players.html'));
    if (p.startsWith('/data/players/') || /^\/data\/ovthumb_[\w-]+\.png$/.test(p)) return sendFile(req, res, P(p.slice(1)));
    if (req.method === 'GET' && p === '/api/catalog') return json(res, catalog());
    // ---- ⭐ THE SPECIALS (/specials): the new OpenRouter format, made on demand for whoever he picks — always a NEW version, even if he already has an old one ----
    if (p === '/specials') return sendFile(req, res, P('public', 'specials.html'));
    if (req.method === 'POST' && p === '/api/special') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); const user = HANDLE(b.user); if (!user) return json(res, { error: 'שם משתמש לא תקין' }, 400);
      const bs = ALL_SETS.find(x => x.id === b.set); if (!bs) return json(res, { error: 'אפקט לא מוכר' }, 400);
      const photoOk = bs.id === 'ov_baby' || !!BODY_FX[bs.id] || !!LION_FX[bs.id];   // the baby and the bodies CAN fall back to his profile photo — but his face from the LIVE is nicer (Shahak), so the live comes first
      if (genJobs.some(j => j.kind === 'opponent' && String(j.user).toLowerCase() === user.toLowerCase() && j.boxer === bs.id && !j.error && !j.ready && Date.now() - j.t < 15 * 60000)) return json(res, { exists: true, msg: 'זה כבר בייצור — עוד רגע' });
      let cap = savedHead(user), photo = '';
      if (!cap) { try { cap = await oppCapture({ user, wait: false }); } catch (e) { if (!photoOk) return json(res, { error: e.message + ' — למכות הוא צריך להיות בלייב (פעם אחת, ואז הפנים נשמרות). לא חויבת' }, 400); cap = null; } }   // one quick look, no waiting for the perfect angle
      if (cap && photoOk && (!cap.ok || !cap.headPath || ((cap.faces || []).length > 1 && (cap.pick ?? -1) < 0 && !cap.verified))) cap = null;   // a bad look at his live → his photo instead
      if (!cap) { photo = [P('data', 'players', pkey(user) + '.jpg'), P('data', 'avatars', pkey(user) + '.jpg')].find(f => fs.existsSync(f)) || ''; if (!photo) { try { const lv = await ttRoomVideo(user, ''); if (lv?.alive) photo = await ownerAvatar(user, lv) || ''; } catch {} } if (!photo) return json(res, { error: 'אין לי תמונה שלו — גרור תמונה שלו בלוח השחקנים, או חכה שיעלה לייב. לא חויבת' }, 400); }
      if (cap) { const bad = (!cap.face || cap.ok === false) ? (cap.why || 'לא מצאתי פנים ברורות') : ((cap.faces || []).length > 1 && (cap.pick ?? -1) < 0 && !cap.verified) ? `יש כמה אנשים בלייב שלו ולא זיהיתי מי מהם ${user}` : ''; if (bad) return json(res, { error: bad + ' — לא חויבת' }, 400); const i = oppCaps.findIndex(c => c.id === cap.id); if (i >= 0) oppCaps[i] = cap; else { oppCaps.unshift(cap); if (oppCaps.length > 12) oppCaps.pop(); } }
      const preview = !!b.preview; let still = '';   // 👁 preview = only the picture (free for punches, ~4¢ for the drawn ones); fromPreview = the approved picture → the video
      if (b.fromPreview) { const pv = previews.get(String(b.fromPreview)); if (pv && pv.user.toLowerCase() === user.toLowerCase() && pv.set === bs.id && fs.existsSync(pv.still)) still = pv.still; }
      if (!still && typeof b.stillFile === 'string' && /^ov_[\w-]+_nb\.png$/.test(b.stillFile) && b.stillFile.toLowerCase().includes(pkey(user).toLowerCase())) { const sf = P('media', 'rejected', b.stillFile); if (fs.existsSync(sf)) still = sf; }
      if (b.auto && !preview) { autoLaunch.add(user.toLowerCase() + '|' + bs.id); autoLaunchEmit(); }
      const job = await opponentPunch({ capId: cap?.id, user, set: bs.id, photo, again: true, dur: [6, 8].includes(+b.dur) ? +b.dur : 5, preview, still });
      return json(res, { ok: true, id: job.id, msg: job.msg || '' }); } catch (e) { return json(res, { error: e.message }, 400); } }
    if (req.method === 'GET' && p === '/api/engines') { let video = [], image = []; try { video = await orVideoModels(); } catch (e) { console.log('[engines video]', e.message); } try { image = await orImageModels(); } catch (e) { console.log('[engines image]', e.message); } return json(res, { current: engines(), names: Object.fromEntries([...video, ...image].map(m => [m.id, engineName(m.id)])), video, image, tested: ENG_TESTED, key: !!settings.openrouterKey }); }
    if (req.method === 'POST' && p === '/api/engines') { const b = JSON.parse((await readBody(req)).toString() || '{}'); const cur = loadJ('engines.json', {}); for (const k of ['video', 'boxer', 'image']) if (typeof b[k] === 'string' && /^[\w.\-\/:]{3,80}$/.test(b[k])) cur[k] = b[k]; if (b.audio != null) cur.audio = !!b.audio; saveJ('engines.json', cur); emit('engines', engines()); return json(res, engines()); }
    if (req.method === 'GET' && p === '/api/players') return json(res, { list: playersList(), now: Date.now(), auto: [...autoLaunch] });
    if (req.method === 'POST' && p === '/api/players/add') { const b = JSON.parse((await readBody(req)).toString() || '{}'); const user = HANDLE(b.user); if (!user) return json(res, { error: 'שם משתמש לא תקין — רק אותיות באנגלית, מספרים, נקודה וקו תחתון' }, 400); const a = loadJ('players.json', []).filter(x => x && String(x.user).toLowerCase() !== user.toLowerCase()); a.unshift({ user, t: Date.now() }); saveJ('players.json', a.slice(0, 300)); emit('players', {}); return json(res, { ok: true, user }); }
    if (req.method === 'PUT' && p === '/api/players/photo') { try { const user = HANDLE(u.searchParams.get('user')); if (!user) return json(res, { error: 'שם משתמש' }, 400); fs.mkdirSync(P('data', 'players'), { recursive: true }); const tmp = P('data', 'players', pkey(user) + '_upload'); fs.writeFileSync(tmp, await readBody(req)); await toJpg(tmp, P('data', 'players', pkey(user) + '.jpg')); try { fs.unlinkSync(tmp); } catch {} emit('players', {}); return json(res, { ok: true }); } catch (e) { return json(res, { error: 'התמונה לא נקלטה: ' + e.message }, 400); } }
    if (req.method === 'POST' && p === '/api/gen/auto') { const b = JSON.parse((await readBody(req)).toString() || '{}'); const user = HANDLE(b.user); const k = String(user).toLowerCase() + '|' + String(b.id || '').replace(/[^\w-]/g, ''); if (user && b.id) { if (b.on) autoLaunch.add(k); else autoLaunch.delete(k); autoLaunchEmit(); } return json(res, { keys: [...autoLaunch] }); }
    if (req.method === 'POST' && p === '/api/gen/opponent/some') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); const user = HANDLE(b.user); if (!user) return json(res, { error: 'שם משתמש לא תקין' }, 400);
      const have = clipsOf(user); const want = BOXER_SET.filter(bs => (b.sets || []).includes(bs.id) && !have.some(c => c.boxer === bs.id) && !genJobs.some(j => j.kind === 'opponent' && String(j.user).toLowerCase() === user.toLowerCase() && j.boxer === bs.id && !j.error && !j.ready && Date.now() - j.t < 15 * 60000));
      if (!want.length) return json(res, { exists: true, msg: 'כבר יש לו את זה (או שזה כבר בייצור) — לא משלמים שוב' });
      if (b.auto) { for (const bs of want) autoLaunch.add(user.toLowerCase() + '|' + bs.id); autoLaunchEmit(); }
      let cap = b.fresh ? null : savedHead(user);   // the head we already caught: no waiting, the same face in his whole set, works after he left the live
      if (!cap) { try { cap = await oppCapture({ user, wait: true }); } catch (e) { cap = savedHead(user); if (!cap) {
        // not live and no saved head: the BABY still works from any photo of him (the one you dropped, or his TikTok picture); the punch sets need him live
        const photo = [P('data', 'players', pkey(user) + '.jpg'), P('data', 'avatars', pkey(user) + '.jpg')].find(f => fs.existsSync(f));
        const others = want.filter(bs => bs.id !== 'ov_baby'); for (const bs of others) autoLaunch.delete(user.toLowerCase() + '|' + bs.id);
        if (photo && want.some(bs => bs.id === 'ov_baby')) { await opponentPunch({ user, set: 'ov_baby', photo }); autoLaunchEmit(); return json(res, { ok: true, started: 1, photoOnly: true, msg: others.length ? `👶 התינוק מתחיל מהתמונה שלו. ${others.length} המכות צריכות שהוא יהיה בלייב — לא חויבת עליהן` : '' }); }
        for (const bs of want) autoLaunch.delete(user.toLowerCase() + '|' + bs.id); autoLaunchEmit(); return json(res, { error: e.message + (want.some(bs => bs.id === 'ov_baby') ? ' — ואין לי תמונה שלו. גרור תמונה שלו לכרטיס והתינוק יעבוד. לא חויבת' : ' — ואין לי ראש שמור שלו. לא חויבת') }, 400); } } }
      const bad = (!cap.face || cap.ok === false) ? (cap.why || 'לא מצאתי פנים ברורות') : ((cap.faces || []).length > 1 && (cap.pick ?? -1) < 0 && !cap.verified) ? `יש ${cap.faces.length} אנשים בלייב שלו ולא זיהיתי מי מהם ${user} — סמן אותו בלוח המלא ("תפוס" → המספר שלו) ונסה שוב` : '';
      if (bad) { for (const bs of want) autoLaunch.delete(user.toLowerCase() + '|' + bs.id); autoLaunchEmit(); return json(res, { error: bad + ' — לא חויבת' }, 400); }
      { const i = oppCaps.findIndex(c => c.id === cap.id); if (i >= 0) oppCaps[i] = cap; else { oppCaps.unshift(cap); if (oppCaps.length > 12) oppCaps.pop(); } }
      const jobs = []; for (const bs of want) jobs.push(await opponentPunch({ capId: cap.id, user, set: bs.id, dur: 5 }));
      return json(res, { ok: true, started: jobs.length, saved: !!cap.saved }); } catch (e) { return json(res, { error: e.message }, 400); } }
    if (req.method === 'POST' && p === '/api/fun/user') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); const user = HANDLE(b.user); if (!user) return json(res, { error: 'שם משתמש לא תקין' }, 400);
      const ks = (b.scenes || []).filter(k => SCENES[k] && !fun.some(it => it.user && it.user.toLowerCase() === user.toLowerCase() && it.scene === k && !/נכשל/.test(it.status || '')));
      if (!ks.length) return json(res, { exists: true, msg: 'כבר יש לו את זה (או שזה כבר בייצור) — לא משלמים שוב' });
      const face = await playerFace(user); if (!face) return json(res, { error: `אין לי תמונה של ${user} — גרור תמונה שלו לכרטיס שלו. לא חויבת` }, 400);
      if (b.auto) { for (const k of ks) autoLaunch.add(user.toLowerCase() + '|' + k); autoLaunchEmit(); }
      for (const k of ks) makeFun(face, k, user, user).catch(() => {}); return json(res, { ok: true, started: ks.length }); } catch (e) { return json(res, { error: e.message }, 400); } }
    if (p.startsWith('/v/')) return sendFile(req, res, P('media', p.slice(3)), 'application/octet-stream');
    if (p.startsWith('/media/')) return sendFile(req, res, P(p.slice(1)));
    if (p.startsWith('/data/avatars/') || p.startsWith('/data/heads/')) return sendFile(req, res, P(p.slice(1)));
    if (p === '/' || p === '/desk' || p === '/fx') return sendFile(req, res, P('public', 'desk.html'));
    if (p === '/old' || p === '/control') return sendFile(req, res, P('public', 'control.html'));
    if (p === '/stage' || p === '/overlay' || p === '/game') return sendFile(req, res, P('public', 'stage.html'));   // /overlay = the main Link layer, /game = the 🍅 layer (short URLs Live Studio accepts)
    if (p === '/cam') { rtc = { offer: null, answer: null, phoneIce: [], camIce: [], t: Date.now(), camState: '' }; return sendFile(req, res, P('public', 'cam.html')); }       // 📱 cloud-Android version: her phone camera + all the effects, one picture
    if (p === '/phone') return sendFile(req, res, P('public', 'phone.html'));   // the page she opens on the phone: sends the camera to /cam
    if (req.method === 'GET' && p === '/api/cloud') return json(res, cloudPub());
    if (req.method === 'POST' && p === '/api/cloud/cast') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); if (b.rtsp != null && !b.on) { settings.cloudRtsp = String(b.rtsp || ''); saveJ('settings.json', settings); } return json(res, b.on ? cloudCastStart(b) : cloudCastStop()); } catch (e) { return json(res, { error: e.message }, 400); } }
    if (p === '/api/phone/screen.mjpeg') { try { res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store', Connection: 'close' }); screenViewers.add(res); req.on('close', () => { screenViewers.delete(res); }); screenPush(); await screenStart(); return; } catch (e) { try { res.end(); } catch {} return; } }
    if (req.method === 'POST' && p === '/api/phone/tap') { const b = JSON.parse((await readBody(req)).toString() || '{}'); const x = Math.round(Math.max(0, Math.min(1, +b.x)) * SCREEN.w), y = Math.round(Math.max(0, Math.min(1, +b.y)) * SCREEN.h); if (b.x2 != null) { const x2 = Math.round(Math.max(0, Math.min(1, +b.x2)) * SCREEN.w), y2 = Math.round(Math.max(0, Math.min(1, +b.y2)) * SCREEN.h); await adbRun(['shell', 'input', 'swipe', String(x), String(y), String(x2), String(y2), String(Math.max(80, Math.min(1500, +b.ms || 250)))]); } else await adbRun(['shell', 'input', 'tap', String(x), String(y)]); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/phone/key') { const b = JSON.parse((await readBody(req)).toString() || '{}'); const K = { back: '4', home: '3', recents: '187', enter: '66' }; if (K[b.k]) await adbRun(['shell', 'input', 'keyevent', K[b.k]]); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/phone/text') { const b = JSON.parse((await readBody(req)).toString() || '{}'); const t = String(b.t || '').slice(0, 200); if (t) await adbRun(['shell', 'input', 'text', t.replace(/[^\w.,@:!?/-]/g, '')]); return json(res, { ok: true }); }
    if (req.method === 'POST' && p === '/api/phone/app') { const b = JSON.parse((await readBody(req)).toString() || '{}'); if (b.app === 'tiktok') await adbRun(['shell', 'monkey', '-p', 'com.zhiliaoapp.musically', '-c', 'android.intent.category.LAUNCHER', '1']); return json(res, { ok: true }); }
    if (req.method === 'GET' && p === '/api/phone/key') return json(res, { key: settings.clientKey });
    if (p === '/api/phone/view.mjpeg') { try { await phoneViewStart(); res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store', Connection: 'close' }); phoneViewers.add(res); req.on('close', () => { phoneViewers.delete(res); if (!phoneViewers.size && phoneView) { try { phoneView.kill('SIGTERM'); } catch {} } }); return; } catch (e) { return json(res, { error: e.message }, 500); } }
    // ---- 📱 external page for the streamer: her camera + a few big effect buttons (no desk, no keys) ----
    if (p === '/client') { if (u.searchParams.get('k') === settings.clientKey) res.setHeader('Set-Cookie', 'bk=' + settings.clientKey + '; Path=/; Max-Age=31536000; SameSite=Lax' + (/trycloudflare\.com$/i.test(String(req.headers.host || '')) ? '; Secure' : '')); return sendFile(req, res, P('public', 'client.html')); }
    if (p === '/api/client/cfg') return json(res, { device: cfDevice(), screen: settings.clientScreen || 'webrtc' });   // webrtc = the phone's native 60fps stream, mjpeg = the old screenshot loop
    if (p === '/client.webmanifest') return sendFile(req, res, P('public', 'client.webmanifest'), 'application/manifest+json');
    if (p === '/app' || p === '/app/') return sendFile(req, res, P('public', 'app', 'index.html'));
    if (/^\/app\/[\w.-]+\.(png|js|html)$/.test(p)) return sendFile(req, res, P('public', 'app', p.slice(5)), p.endsWith('.js') ? 'text/javascript' : undefined);
    if (req.method === 'GET' && p === '/api/client/list') {
      const names = loadJ('overlays.json', {});
      const ovs = fs.readdirSync(P('media', 'overlays')).filter(f => f.endsWith('.webm') && fs.existsSync(P('media', 'overlays', f.replace(/\.webm$/, '.json')))).map(f => f.replace(/\.webm$/, '')).map(id => { const o = typeof names[id] === 'object' ? names[id] : { he: names[id] }; return { kind: 'overlay', id, name: o.he || (/-([\w.]+?)__H_/.exec(id)?.[1] ? '🥊 ' + /-([\w.]+?)__H_/.exec(id)[1] : id.replace(/^ov_+/, '').replace(/_+/g, ' ').trim() || id), user: o.user || '', thumb: fs.existsSync(P('media', 'thumbs', id + '.jpg')) ? '/media/thumbs/' + id + '.jpg' : '' }; });
      const cur = HANDLE(oppLive.user || opp.handle);
      let items = [
        ...clips.map(c => ({ kind: 'clip', id: c.id, name: c.name, thumb: c.thumb || '' })),
        ...fx.map(f => ({ kind: 'fx', id: f.id, name: f.name, thumb: f.thumb || '' })),
        ...ovs.filter(o => !o.user || o.user === cur) ];
      // first test = two effects only (settings.clientItems = ["overlay:boxer1", ...] widens it later from the desk)
      const allow = Array.isArray(settings.clientItems) && settings.clientItems.length ? settings.clientItems : null;   // empty = everything (the panel groups them by kind)
      if (allow) items = items.filter(it => allow.includes(it.kind + ':' + it.id));
      return json(res, { opponent: cur, phone: !!rtc.offer, items });
    }
    if (req.method === 'POST' && p === '/api/client/items') { try { const b = JSON.parse((await readBody(req)).toString() || '{}'); settings.clientItems = (b.items || []).map(String).slice(0, 60); saveJ('settings.json', settings); return json(res, { ok: true, items: settings.clientItems }); } catch (e) { return json(res, { error: e.message }, 400); } }
    if (req.method === 'POST' && p === '/api/client/play') { try { const { kind, id } = JSON.parse((await readBody(req)).toString() || '{}'); const cid = String(id).replace(/[^\w-]/g, '');
      if (kind === 'clip') return json(res, playClip(cid)); if (kind === 'fx') return json(res, playFx(cid)); if (kind === 'stop') { emit('stop', {}); clipEnded('stopped'); return json(res, { ok: true }); }
      const j = P('media', 'overlays', cid + '.json'); if (!fs.existsSync(j)) return json(res, { error: 'no overlay' }, 404); const track = JSON.parse(fs.readFileSync(j, 'utf8')); const nm0 = loadJ('overlays.json', {})[cid]; const nm = typeof nm0 === 'object' ? nm0 : {};
      const k = nm.face ?? 0; if (track.tracks && track.tracks[k]) track.frames = track.tracks[k]; track.swap = false; track.pos = nm.pos || 'center'; track.size = +(nm.size || 0.75); track.bottom = +(nm.bottom ?? 0); track.head = +(nm.head ?? 1); track.attach = ''; track.hitAt = null; track.dir = 1;
      emit('overlay', { id: cid, loop: false, webm: '/media/overlays/' + cid + '.webm', track }); return json(res, { ok: true }); } catch (e) { return json(res, { error: e.message }, 400); } }
    // ---- WebRTC signalling for phone → cam (one room, in memory) ----
    if (p.startsWith('/api/rtc/')) {
      const part = p.slice(9); res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate'); res.setHeader('CDN-Cache-Control', 'no-store');
      if (req.method === 'GET' && part === 'state') return json(res, { offer: rtc.offer, answer: rtc.answer, phoneIce: rtc.phoneIce.length, camIce: rtc.camIce.length, t: rtc.t });
      const b = req.method === 'POST' ? JSON.parse((await readBody(req)).toString() || '{}') : {};
      if (part === 'offer' && +b.v !== 2) return json(res, { ok: false, old: true });   // an old tab still open on the phone must not fight the current page
      if (part === 'offer') { const id = String(b.id || ''); if (rtc.owner && rtc.owner !== id && Date.now() - (rtc.ownerAt || 0) < 45000) return json(res, { ok: false, busy: true });   // one page at a time: other tabs go idle
        rtc = { offer: b.sdp || null, answer: null, phoneIce: [], camIce: [], t: Date.now(), camState: 'offer', owner: id, ownerAt: Date.now() }; emit('rtc', { offer: true }); return json(res, { ok: true, t: rtc.t }); }
      if (part === 'phonestate') { rtc.phoneState2 = String(b.state || ''); return json(res, { ok: true }); }
      if (part === 'camstate') { rtc.camState = String(b.state || ''); if (rtc.offer && Date.now() - rtc.t > 10000 && /(^|conn:)(failed|closed)\b/.test(rtc.camState)) { rtc = { offer: null, answer: null, phoneIce: [], camIce: [], t: Date.now(), camState: 'dropped', owner: null, ownerAt: 0, phoneState2: '' }; console.log('[rtc] camera line dropped — phone will re-offer'); } emit('cloud', cloudPub()); return json(res, { ok: true }); }   // the cloud page lost the line → new session stamp → the phone re-offers by itself
      if (part === 'answer') { rtc.answer = b.sdp || null; return json(res, { ok: true }); }   // t stays the offer's stamp — the phone compares it to decide "is this still my session"
      if (part === 'ice') { (b.from === 'phone' ? rtc.phoneIce : rtc.camIce).push(b.candidate); return json(res, { ok: true }); }
      if (part === 'poll') { const role = String(b.role || u.searchParams.get('role') || ''); if (role === 'phone' && rtc.owner && u.searchParams.get('id') === rtc.owner) rtc.ownerAt = Date.now(); const since = +(b.since ?? u.searchParams.get('since') ?? 0); const arr = role === 'phone' ? rtc.camIce : rtc.phoneIce; return json(res, { offer: role === 'cam' ? rtc.offer : null, answer: role === 'phone' ? rtc.answer : null, ice: arr.slice(since), next: arr.length, t: rtc.t }); }
      return json(res, { error: 'rtc?' }, 404);
    }   // /overlay = the main Link layer, /game = the 🍅 layer (short URLs Live Studio accepts)
    res.writeHead(404); res.end('not found');
  } catch (e) { json(res, { error: e.message }, 500); }
});
server.on('upgrade', cfUpgrade);
server.listen(PORT, () => {
  console.log(`\n  ARIEL LIVE is running\n  control: http://localhost:${PORT}/\n  stage (for Live Studio): http://localhost:${PORT}/stage\n  key: ${KEY ? 'OK' : 'MISSING'}\n`);
});
