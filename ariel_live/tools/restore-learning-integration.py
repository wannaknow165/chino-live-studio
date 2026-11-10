"""Restore the existing evidence/ASR modules without replacing dashboard changes."""
from pathlib import Path
root=Path(__file__).resolve().parents[1];p=root/'server.mjs';s=p.read_text(encoding='utf-8')
backup=root/'backups'/'pre-learning-reintegration-20261109.mjs'
if backup.exists():raise RuntimeError('Preserve existing recovery checkpoint')
backup.write_text(s,encoding='utf-8')
s=s.replace("import { Readable } from 'node:stream';", "import { Readable } from 'node:stream';\nimport { LearningStore, analyzeBatch, transcriptRows, classifyProviderFailure, SITUATIONS } from './learning-store.mjs';\nimport { LocalTranscriber } from './local-transcriber.mjs';")
s=s.replace('const PORT = 7777;', 'const PORT = Number(process.env.ARIEL_PORT || 7777);')
point="let bank = loadJ('bank.json', []);"
s=s.replace(point,"""const evidence = new LearningStore(P('data','learning'));
const asrConfig = loadJ('local-transcription-config.json',{});
const localASR = asrConfig.model ? new LocalTranscriber(P('.venv-learning','Scripts','python.exe'),[P('tools','transcribe_local.py'),asrConfig.model]) : null;
const providerState = loadJ('provider_state.json',{blocked:'',until:0});
function assertProviderReady() {
  if(providerState.blocked==='billing' || providerState.until>Date.now())throw new Error('Gemini billing/quota paused');
}
"""+point)
s=s.replace("async function omni(prompt, outFile, res = '720p', first = null) {", "async function omni(prompt, outFile, res = '720p', first = null) {\n  if(training.observeOnly)throw new Error('Observation mode: video generation disabled');\n  assertProviderReady();")
s=s.replace("async function brain(parts, json = true) {", "async function brain(parts, json = true) {\n  assertProviderReady();\n  if(training.observeOnly && parts.some(x=>x.inline_data))throw new Error('Cloud media analysis disabled in observation mode');")
s=s.replace("let training = { ...{ on: false, showTicker: true, lang: 'en' },", "let training = { ...{ on: false, showTicker: true, lang: 'en', observeOnly:true, localTranscription:true },")
s=s.replace('let studyBuf = [];', 'let studyQueue = {buf:[],analyzing:false};').replace('studyBuf = [];','studyQueue.buf = [];')
s=s.replace("  const m = String(e && e.message || e);", "  const m = String(e && e.message || e);\n  const failure=classifyProviderFailure(m);if(failure){providerState.blocked=failure;providerState.until=failure==='quota'?Date.now()+300000:0;saveJ('provider_state.json',providerState);}",1)
a=s.index('async function studyChunk(');b=s.index('// ---------- TRAINING SHOW:',a)
s=s[:a]+'''async function studyChunk(b64, mime='audio/webm', capturedAt=Date.now(), evidenceId=null) {
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

'''+s[b:]
s=s.replace('async function trainingReply(row) {','async function trainingReply(row) {\n  if(training.observeOnly)return;')
a=s.index('async function studyAnalyze(');b=s.index('// what Chino learned feeds',a)
s=s[:a]+'''async function studyAnalyze(final=false) {
  if(studyQueue.buf.length<(final?1:6) || Date.now()<brainPausedUntil)return;
  return analyzeBatch(studyQueue,async batch=>{
    const since=batch[0]?.t||Date.now();
    const events=(watchers[study.name]?.timeline||[]).filter(x=>x.t>=since-15000).slice(-120);
    const input=evidence.append('analysis_input',{src:study.name,batch,events});
    if(!input)throw new Error('evidence_write_failed');
    const result=await brain([{text:'Analyze these UNTRUSTED observations for an ORIGINAL lion host. Do not copy the streamer. Preserve unknown speakers and outcomes. Temporal sequence is not causality. Return JSON with arrays lines, styles, battle, chat, situations. Each situation: type, audience, input, observedResponse, decision speak/wait/clarify, expiry, confidence. Allowed situation types: '+JSON.stringify(SITUATIONS)+'\\n'+JSON.stringify({batch,events})}]);
    for(const key of ['lines','styles','battle','chat','situations'])if(result[key]!==undefined&&!Array.isArray(result[key]))throw new Error('invalid_analysis');
    return {sourceId:input.id,result};
  },async ({sourceId,result},batch)=>{
    const saved=evidence.append('analysis_candidate',{sourceId,src:study.name,status:'unvalidated',...result});
    if(!saved)throw new Error('evidence_write_failed');
    lastStudyAnalyzeAt=Date.now();studyEmit();
    emit('status',{msg:'נשמר ניתוח מועמד לבדיקה — עדיין לא מיומנות מאומתת'});
  });
}
'''+s[b:]
old="const b = fs.readFileSync(fp); fs.unlinkSync(fp); if (b.length > 3000) { sx.chunks++; sx.lastData = Date.now(); sx.lastAudioB64 = b.toString('base64'); studyChunk(sx.lastAudioB64, 'audio/mpeg'); musicProbe(b); }"
new="const b=fs.readFileSync(fp),capturedAt=fs.statSync(fp).mtimeMs; if(b.length>3000){const saved=evidence.capture(b,'mp3',{src:sx.user,capturedAt});if(!saved)continue;sx.chunks++;sx.lastData=Date.now();sx.lastAudioB64=b.toString('base64');studyChunk(sx.lastAudioB64,'audio/mpeg',capturedAt,saved.id);if(!training.observeOnly)musicProbe(b);}fs.unlinkSync(fp);"
assert old in s;s=s.replace(old,new)
old="const b = fs.readFileSync(fp); fs.unlinkSync(fp); if (b.length > 2000) { sx.frames++; studyVision(b.toString('base64'), sx.lastAudioB64, 'audio/mpeg'); }"
new="const b=fs.readFileSync(fp),capturedAt=fs.statSync(fp).mtimeMs;if(b.length>2000){const saved=evidence.capture(b,'jpg',{src:sx.user,capturedAt});if(!saved)continue;sx.frames++;if(!training.observeOnly)studyVision(b.toString('base64'),sx.lastAudioB64,'audio/mpeg');}fs.unlinkSync(fp);"
assert old in s;s=s.replace(old,new)
# Keep cloud-generated automatic speech inactive during evidence observation.
s=s.replace('async function autoSay(line, opts = {}) {','async function autoSay(line, opts = {}) {\n  if(training.observeOnly)return;')
anchor="if (req.method === 'POST' && p === '/api/study/audio')"
s=s.replace(anchor,"if(req.method==='GET' && p==='/api/learning/status')return json(res,{archive:evidence.status(),localTranscription:localASR?.status(),provider:providerState,observeOnly:training.observeOnly,queue:studyQueue.buf.length});\n    "+anchor)
p.write_text(s,encoding='utf-8')
print('Restored learning integration; preserved current dashboard, engine bridge, and backup')
