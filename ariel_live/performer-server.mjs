import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Budget, Performer } from './performer-core.mjs';
import { OpenAIPerformer } from './performer-provider.mjs';
import { LocalTranscriber } from './local-transcriber.mjs';
import { OriginalVoice } from './original-voice.mjs';
import { MusicMotion } from './music-motion.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const P = (...a) => path.join(ROOT, ...a), port = Number(process.env.PERFORMER_PORT || 7778);
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
let cfg = readJson(P('data', 'performer-config.json'), {});
if (!cfg.asset || !cfg.threeRoot) throw new Error('performer-config.json must point to the existing lion and Three.js installation');
const runtimeDir = P('data', 'performer'); fs.mkdirSync(runtimeDir, { recursive: true });
const budget = new Budget(path.join(runtimeDir, 'budget.json'));
const originalVoice = new OriginalVoice({bankFile:P('data','bank.json'),bankDir:P('media','bank'),audioDir:P('media','speech'),rhubarb:cfg.rhubarb || 'C:/Users/shk/Tools/Rhubarb-Lip-Sync-1.14.0-Windows/rhubarb.exe'});
const provider = new OpenAIPerformer({ budget, audioDir: P('media', 'speech'), reviewsFile: P('data', 'chat-reviewed-behaviors.json'), originalVoice });
let recording = {state:'idle',file:null};
const clients = new Set();
let stage = { id: '', seen: 0, ready: false, audio: false, fps: 0, error: '', frame: 'seated' };
let scene = { version: 1, background: 'royal', foreground: null, framing: 'seated', lighting: 'warm', transparent: false,
  ...readJson(path.join(runtimeDir, 'scene.json'), {}) };
const emit = (type, data) => { const s = 'data: ' + JSON.stringify({ type, ...data }) + '\n\n'; for (const c of clients) c.write(s); };
const musicMotion=new MusicMotion(P('tools','music-motion.py'),d=>emit('music-motion',d));
const stageReady = () => stage.ready && stage.audio && Date.now() - stage.seen < 10000;
const performer = new Performer({
  decide: (...args) => provider.decide(...args), voice: (...args) => provider.voice(...args),
  emit: (type, data) => emit(type, type === 'utterance' ? { ...data, stageId: stage.id } : data), stageReady,
});
const asrConfig = readJson(P('data', 'local-transcription-config.json'), {});
const transcriber = asrConfig.model ? new LocalTranscriber(P('.venv-learning', 'Scripts', 'python.exe'), [P('tools', 'transcribe_local.py'), asrConfig.model]) : null;
const status = () => ({ performer: performer.status(), provider: provider.status(), budget: budget.status(),
  stage: { ...stage, ready: stage.ready && Date.now() - stage.seen < 10000 }, scene, transcriber: transcriber?.status(),
  liveConnection, recording, music:musicMotion.status(), lipSync: 'local phonetic cues, audio clock; quality requires visual review' });
let liveConnection = { connected: false, room: '', error: '' };
const allowedOrigins = new Set([ 'http://localhost:' + port, 'http://127.0.0.1:' + port, 'http://localhost:7777', 'http://127.0.0.1:7777' ]);
const json = (res, value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
async function body(req, max = 2 * 1024 * 1024) {
  const parts = []; let n = 0;
  for await (const p of req) { n += p.length; if (n > max) throw new Error('body_too_large'); parts.push(p); }
  return Buffer.concat(parts);
}
async function jsBody(req) { return JSON.parse((await body(req, 32000)).toString() || '{}'); }
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
  '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4' };
function file(req, res, f) {
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return json(res, { error: 'not_found' }, 404);
  const size = fs.statSync(f).size; let start = 0, end = size - 1, code = 200;
  const headers = { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  if (req.headers.range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if (!m || +m[1] >= size || (m[2] && +m[2] < +m[1])) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); return res.end(); }
    start = +m[1]; end = m[2] ? Math.min(+m[2], size - 1) : end; code = 206;
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
  }
  headers['Content-Length'] = end - start + 1; res.writeHead(code, headers);
  fs.createReadStream(f, { start, end }).pipe(res);
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) return json(res, { error: 'origin_not_allowed' }, 403);
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Source,X-Stage-Id' }); return res.end(); }
  const u = new URL(req.url, 'http://localhost'); const route = decodeURIComponent(u.pathname);
  if (!/^localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/.test(req.headers.host || '')) return json(res, { error: 'invalid_host' }, 403);
  try {
    if (req.method === 'GET' && route === '/api/status') return json(res, status());
    if (req.method === 'GET' && route === '/api/voice/bank') return json(res, originalVoice.catalog());
    if (route === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('data: ' + JSON.stringify({ type: 'hello', scene, epoch: performer.epoch }) + '\n\n');
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (req.method === 'POST') {
      if (route === '/api/recording/upload') {
        if (req.headers['x-stage-id'] !== stage.id || !stage.id || recording.state !== 'recording') throw new Error('recording_not_authorized');
        const bytes = await body(req,64*1024*1024);
        if (bytes.length<1000 || bytes.readUInt32BE(0)!==0x1a45dfa3) throw new Error('invalid_webm');
        const dir=P('media','recordings');fs.mkdirSync(dir,{recursive:true});
        const name='lion-'+Date.now()+'.webm';fs.writeFileSync(path.join(dir,name),bytes);
        recording={state:'saved',file:'/recordings/'+name,bytes:bytes.length};emit('recording',recording);return json(res,recording);
      }
      if (route === '/api/layers/upload') {
        const ext={ 'image/png':'png','image/jpeg':'jpg','video/webm':'webm','video/mp4':'mp4' }[req.headers['content-type']];
        if(!ext)throw new Error('unsupported_layer_type');
        const bytes=await body(req,40*1024*1024),name=crypto.randomBytes(16).toString('hex')+'.'+ext;
        const dir=P('media','layers');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),bytes);
        return json(res,{url:'/layers/'+name});
      }
      if (route === '/api/input/audio') {
        if (!transcriber) throw new Error('local_transcription_unavailable');
        if (performer.externalClip || performer.phase === 'speaking') throw new Error('input_held_during_output');
        const source = req.headers['x-source']; if (!['opponent', 'operator'].includes(source)) throw new Error('input_source_required');
        const epoch = performer.epoch, inputAt=Date.now(); const audio = await body(req);
        const result = await transcriber.transcribe(audio.toString('base64'));
        const text = result.lines.filter(x => x.avgLogprob > -1).map(x => x.text).join(' ').trim().slice(0, 1200);
        let reply=null;
        if (text && epoch === performer.epoch) {
          emit('transcript', { text, source, verifiedSpeaker: false });
          if(source==='operator' && req.headers['x-mode']==='respond')reply=await performer.respond({kind:'opponent',text,at:inputAt,source:'rehearsal'});
          if(source==='operator' && req.headers['x-mode']==='echo')reply=await performer.say(text,result.language==='en'?'en':'he');
          if (source === 'opponent' && performer.mode === 'auto') performer.ingest({ kind: 'opponent', source: 'live', room: performer.room, text, at: Date.now() });
        }
        return json(res, { text, reply, language: result.language, speakerVerification: 'selected_input_only' });
      }
      const b = await jsBody(req);
      if(route==='/api/music'){b.enabled?musicMotion.start():musicMotion.stop();return json(res,musicMotion.status())}
      if (route === '/api/recording/start') {
        if(!stageReady())throw new Error('stage_audio_not_ready');
        if(recording.state==='recording')throw new Error('recording_busy');
        const seconds=Math.max(3,Math.min(30,+b.seconds||15));recording={state:'recording',file:null};
        emit('record-start',{stageId:stage.id,seconds});return json(res,recording);
      }
      if (route === '/api/recording/error') {
        if(b.stageId!==stage.id)throw new Error('stage_not_owner');recording={state:'error',file:null,error:String(b.error).slice(0,100)};return json(res,recording);
      }
      if (route === '/api/voice/bank/say') {
        const item=originalVoice.catalog().find(x=>x.id===b.id);if(!item)throw new Error('phrase_not_found');
        return json(res,await performer.say(item.text,item.language));
      }
      if (route === '/api/credential') { provider.setKey(b.key); return json(res, { configured: true, persistence: 'memory_only' }); }
      if (route === '/api/mode') { performer.setMode(b.mode); return json(res, performer.status()); }
      if (route === '/api/stop') { performer.stop(); return json(res, { ok: true }); }
      if (route === '/api/say') return json(res, await performer.say(b.text, b.language));
      if (route === '/api/respond') return json(res, await performer.respond({ kind: b.kind || 'chat', text: String(b.text || ''), name: String(b.name || '').slice(0, 60), at: Date.now(), source: 'rehearsal' }));
      if (route === '/api/input/activity') { performer.speaking(b.active); return json(res, { ok: true }); }
      if (route === '/api/clip') { performer.clip(b.playing); return json(res, { ok: true }); }
      if (route === '/api/stage/claim') {
        if (stage.id && Date.now() - stage.seen < 10000 && stage.id !== b.id) return json(res, { error: 'stage_already_active' }, 409);
        performer.cancel('stage_changed'); stage = { id: crypto.randomUUID(), seen: Date.now(), ready: false, audio: false, fps: 0, error: '' };
        return json(res, { stageId: stage.id });
      }
      if (route === '/api/stage/status') {
        if (b.stageId !== stage.id) return json(res, { error: 'stage_not_owner' }, 409);
        stage = { ...stage, seen: Date.now(), ready: !!b.ready, audio: !!b.audio, fps: Math.max(0, Math.min(240, +b.fps || 0)), error: String(b.error || '').slice(0, 120) };
        return json(res, { ok: true });
      }
      if (route === '/api/stage/ack') {
        if (b.stageId !== stage.id) return json(res, { error: 'stage_not_owner' }, 409);
        return json(res, { ok: performer.ack(b.id, b.epoch, b.state) });
      }
      if (route === '/api/scene') {
        if (b.framing && !['seated', 'portrait', 'battle'].includes(b.framing)) throw new Error('invalid_framing');
        if (b.lighting && !['warm', 'neutral', 'cool'].includes(b.lighting)) throw new Error('invalid_lighting');
        if (b.background && !['royal', 'studio', 'transparent'].includes(b.background) && !/^\/layers\/[a-f0-9]{32}\.(png|jpg|mp4|webm)$/.test(b.background)) throw new Error('invalid_background');
        if (b.foreground != null && !/^\/layers\/[a-f0-9]{32}\.(png|webm)$/.test(b.foreground)) throw new Error('invalid_foreground');
        for (const k of ['framing', 'lighting', 'background', 'foreground']) if (Object.hasOwn(b, k)) scene[k] = b[k];
        scene.transparent = scene.background === 'transparent';
        fs.writeFileSync(path.join(runtimeDir, 'scene.json'), JSON.stringify(scene, null, 2));
        emit('scene', scene); return json(res, scene);
      }
      if (route === '/api/pose') {
        const allowed = ['neutral', 'open', 'seal', 'round', 'smile', 'blink'];
        if (!allowed.includes(b.pose)) throw new Error('invalid_pose');
        emit('pose', { pose: b.pose }); return json(res, { ok: true });
      }
      return json(res, { error: 'not_found' }, 404);
    }
    if (route === '/' || route === '/control') return file(req, res, P('public', 'performer-control.html'));
    if (route === '/stage') return file(req, res, P('public', 'performer-stage.html'));
    if (route === '/design') { res.writeHead(302,{Location:'/stage?preview=1','Cache-Control':'no-store'}); return res.end(); }
    if (route === '/royal-design.mjs') return file(req,res,P('public','royal-design.mjs'));
    if (route === '/assets/royal-hero.glb') {const current=readJson(P('data','performer-config.json'),cfg);return file(req,res,current.designAsset||P('data','performer','royal-hero-v11','royal-lion-hero-v11.glb'));}
    if (route === '/assets/royal-chair.glb') return file(req,res,P('data','performer','royal-throne-v2','royal-throne-fitted.glb'));
    if (route === '/performer-stage.mjs') return file(req, res, P('public', 'performer-stage.mjs'));
    if (route === '/performer-visemes.mjs') return file(req,res,P('public','performer-visemes.mjs'));
    if (route === '/performer-gestures.mjs') return file(req,res,P('public','performer-gestures.mjs'));
    if (route === '/assets/lion.glb') return file(req, res, cfg.asset);
    if (route === '/assets/set.glb' && cfg.setAsset) return file(req, res, cfg.setAsset);
    if (route === '/api/assets') {cfg=readJson(P('data','performer-config.json'),cfg);return json(res,{lion:'/assets/lion.glb?v='+fs.statSync(cfg.asset).mtimeMs,set:cfg.setAsset?'/assets/set.glb':null});}
    if (/^\/audio\/[a-f0-9]{64}\.wav$/.test(route)) return file(req, res, P('media', 'speech', path.basename(route)));
    if (/^\/recordings\/lion-\d{13}\.webm$/.test(route)) return file(req,res,P('media','recordings',path.basename(route)));
    if (/^\/layers\/[a-f0-9]{32}\.(png|jpg|mp4|webm)$/.test(route)) return file(req, res, P('media', 'layers', path.basename(route)));
    if (route.startsWith('/three/')) {
      const target = path.resolve(cfg.threeRoot, route.slice(7));
      if (!target.startsWith(path.resolve(cfg.threeRoot) + path.sep) || !target.endsWith('.js')) return json(res, { error: 'invalid_path' }, 403);
      return file(req, res, target);
    }
    return json(res, { error: 'not_found' }, 404);
  } catch (e) { json(res, { error: e.name === 'AbortError' ? 'cancelled' : e.message }, 400); }
});
setInterval(() => performer.tick().catch(() => {}), 500).unref();
setInterval(() => {
  if (stage.id && Date.now() - stage.seen > 10000 && performer.phase !== 'idle') performer.cancel('stage_lost');
  for (const c of clients) c.write(': heartbeat\n\n');
}, 3000).unref();

// Subscribe to the existing dashboard's OWN-room events. Study watcher events
// are intentionally excluded: observing someone else's live never starts replies.
async function liveBridge() {
  for (;;) {
    try {
      const t = await (await fetch('http://127.0.0.1:7777/api/tiktok', { signal: AbortSignal.timeout(5000) })).json();
      liveConnection = { connected: !!t.on, room: t.user || '', error: '' }; performer.setRoom(t.on ? t.user : '');
      const r = await fetch('http://127.0.0.1:7777/api/events');
      const decoder = new TextDecoder(); let buffer = '';
      for await (const chunk of r.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const line = frame.split('\n').find(x => x.startsWith('data: ')); if (!line) continue;
          const e = JSON.parse(line.slice(6));
          if (e.type === 'tiktok') { liveConnection = { connected: !!e.on, room: e.user || '', error: '' }; performer.setRoom(e.on ? e.user : ''); }
          if (e.type === 'chatmsg' && liveConnection.connected) performer.ingest({
            kind: ['gift', 'follow', 'join'].includes(e.kind) ? e.kind : 'chat',
            text: String(e.text || ''), name: String(e.name || ''), source: 'live', room: liveConnection.room, at: Date.now(),
          });
          if (e.type === 'stop') performer.stop();
          if (e.type === 'play') performer.clip(true);
        }
      }
    } catch { liveConnection = { connected: false, room: '', error: 'dashboard_disconnected' }; performer.setRoom(''); }
    await new Promise(r => setTimeout(r, 3000));
  }
}
server.listen(port, '127.0.0.1', () => { console.log('Lion performer http://localhost:' + port + ' (manual, local only)'); liveBridge(); });
function shutdown() { performer.stop(); transcriber?.stop(); musicMotion.stop(); server.close(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
