import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { normalizeTikEvent } from './tiktools-events.mjs';
import { LearningStore, analyzeBatch, transcriptRows, classifyProviderFailure } from './learning-store.mjs';

function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariel-learning-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
test('TikTools retains team identities and treats status 4 as active', () => {
  const r = normalizeTikEvent('battleArmies', { status: 4, matchId: 'round', secsRemaining: 20, hosts: [{ hostUserId: '1', isTeam: true, teamTotalScore: 900, members: [{ userId: '1234567', score: 500 }], contributors: [{ userId: 'viewer', score: 100, nickname: 'fixture' }] }], apiKey: 'must-not-save' }, 'fixture');
  assert.equal(r.phase, 'active'); assert.equal(r.payload.hosts[0].members[0].userId, '1234567');
  assert.equal(r.payload.hosts[0].contributors[0].score, 100);
  assert.equal(JSON.stringify(r).includes('must-not-save'), false);
  assert.equal(normalizeTikEvent('battleArmies', { status: 4, secsRemaining: 0 }, 'fixture').phase, 'ended');
  assert.equal(normalizeTikEvent('battleArmies', { status: 2 }, 'fixture').phase, 'ended');
});
test('media and transcript retain provenance across a restart', t => {
  const dir = temp(t), store = new LearningStore(dir);
  const row = store.capture(Buffer.from('audio evidence'), 'mp3', { src: 'fixture-host', capturedAt: 1000 });
  assert.equal(fs.readFileSync(path.join(dir, row.file), 'utf8'), 'audio evidence');
  const transcript = store.append('transcript', { src: row.src, evidenceId: row.id, text: 'hello' });
  assert.equal(transcript.evidenceId, row.id);
  const reopened = new LearningStore(dir);
  assert.equal(reopened.bytes, store.bytes);
  assert.equal(fs.readFileSync(path.join(dir, 'observations.jsonl'), 'utf8').trim().split('\n').length, 2);
});
test('storage limit preserves existing evidence and reports capture failure', t => {
  const store = new LearningStore(temp(t), 5000);
  const row = store.capture(Buffer.alloc(50), 'jpg', { src: 'fixture' });
  assert.ok(row);
  assert.equal(store.capture(Buffer.alloc(5000), 'mp3', {}), null);
  assert.equal(store.status().error, 'storage_limit');
  assert.equal(fs.statSync(path.join(store.root, row.file)).size, 50);
});
test('failed analysis and failed commit both preserve queue', async () => {
  const row = { text: 'hello' }, owner = { buf: [row] };
  await assert.rejects(analyzeBatch(owner, async () => { throw new Error('billing'); }, async () => {}));
  assert.deepEqual(owner.buf, [row]); assert.equal(owner.analyzing, false);
  await assert.rejects(analyzeBatch(owner, async () => ({}), async () => { throw new Error('disk'); }));
  assert.deepEqual(owner.buf, [row]);
});
test('single analysis owns a snapshot while new events stay queued', async () => {
  const old = { text: 'old' }, fresh = { text: 'fresh' }, owner = { buf: [old] };
  let finish; const pending = analyzeBatch(owner, () => new Promise(r => { finish = r; }), async () => {});
  owner.buf.push(fresh);
  assert.equal(await analyzeBatch(owner, () => { throw new Error('duplicate'); }, async () => {}), false);
  finish({}); await pending; assert.deepEqual(owner.buf, [fresh]);
});
test('bounded analysis preserves every observation outside the analyzed batch', async () => {
  const rows=Array.from({length:45},(_,id)=>({id,text:'observation '+id}));
  const owner={buf:[...rows]};let committed=[];
  await analyzeBatch(owner,async batch=>batch.map(r=>r.id),async result=>{committed=result;},{maxRows:20});
  assert.deepEqual(committed,rows.slice(0,20).map(r=>r.id));
  assert.deepEqual(owner.buf,rows.slice(20));
});

test('transcripts use capture time, preserve unknown speaker, reject malformed lines', () => {
  const rows = transcriptRows([{ who: 'uncertain', text: 'hello' }, { who: 'OTHER', text: 'reply' }, { text: {} }], { src: 'fixture', capturedAt: 1000, evidenceId: 'capture-id' });
  assert.equal(rows.length, 2); assert.equal(rows[0].who, 'UNKNOWN');
  assert.equal(rows[0].t, 1000); assert.equal(rows[1].who, 'OTHER');
  assert.equal(rows[0].evidenceId, 'capture-id');
});
test('billing, quota and unrelated errors stay distinct', () => {
  assert.equal(classifyProviderFailure('Your prepayment credits are depleted'), 'billing');
  assert.equal(classifyProviderFailure('429 RESOURCE_EXHAUSTED'), 'quota');
  assert.equal(classifyProviderFailure('Malformed JSON'), '');
});

const server = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
function studyHarness(brain) {
  const records = [], queue = { buf: [{ t: 1000, who: 'HOST', text: 'hello' }] };
  const context = vm.createContext({
    brain, studyBrain:async(batch,events)=>brain([{text:JSON.stringify({batch,events})}]), Date, SITUATIONS: ['question'], analyzeBatch, lastStudyAnalyzeAt: 0, brainPausedUntil: 0,
    studyQueue: queue, study: { name: 'fixture', lessons: { lines: [], styles: [], battle: [], chat: [], sessions: [] } },
    watchers: {}, norm: x => x, evidence: { append(kind, data) { const row = { id: 'e' + records.length, kind, ...data }; records.push(row); return row; } },
    saveJ() {}, studyEmit() {}, emit() {}, learnLog() {},
  });
  vm.runInContext(server.slice(server.indexOf('async function studyAnalyze('), server.indexOf('// what Chino learned feeds')), context);
  return { context, queue, records };
}
test('real study function retains observations when provider fails', async () => {
  const h = studyHarness(async () => { throw new Error('credits depleted'); });
  await assert.rejects(h.context.studyAnalyze(true));
  assert.equal(h.queue.buf.length, 1); assert.equal(h.records[0].kind, 'analysis_input');
});
test('real study function links successful candidate to input evidence', async () => {
  const h = studyHarness(async () => ({ lines: [], situations: [{ type: 'question', audience: 'opponent' }] }));
  await h.context.studyAnalyze(true);
  assert.equal(h.queue.buf.length, 0);
  assert.equal(h.records[1].sourceId, h.records[0].id);
  assert.equal(h.records[1].status, 'unvalidated');
});
test('invalid model output does not consume study observations', async () => {
  const h = studyHarness(async () => ({ lines: 'not an array' }));
  await assert.rejects(h.context.studyAnalyze(true)); assert.equal(h.queue.buf.length, 1);
});
test('billing pause makes no provider request', async () => {
  let called = false;
  const context = vm.createContext({ assertProviderReady() { throw new Error('billing paused'); }, fetch() { called = true; }, evidence: { append() {} } });
  vm.runInContext(server.slice(server.indexOf('async function brain('), server.indexOf('// ---------- quality check')), context);
  await assert.rejects(context.brain([{ text: 'test' }])); assert.equal(called, false);
});
test('observation mode blocks video before any provider request', async () => {
  let called = false;
  const context = vm.createContext({ training: { observeOnly: true }, fetch() { called = true; } });
  vm.runInContext(server.slice(server.indexOf('async function omni('), server.indexOf('async function brain(')), context);
  await assert.rejects(context.omni('test', 'unused')); assert.equal(called, false);
});
test('control scripts parse and music UI is defined at top level', () => {
  const html = fs.readFileSync(new URL('./public/control.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) { const check = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: match[1], encoding: 'utf8' }); assert.equal(check.status, 0, check.stderr); }
  // The layout changed; verify the stream renderer is declared at script scope,
  // not the historical position of a comment next to its event handler.
  assert.match(html, /^function sxUI\(j\)/m);
  assert.match(html, /\['למידה[^']*','learn'\]/);
});

test('live study uses offline transcription while Gemini billing is paused', async () => {
  const records = [], queue = { buf: [] };
  const context = vm.createContext({
    Date, transcriptRows, training: { localTranscription: true, observeOnly: true, on: false },
    localASR: { async transcribe() { return { lines: [{ who: 'UNKNOWN', text: 'fixture speech', start: 0, end: 2 }] }; } },
    brain() { throw new Error('Must not call paid provider'); }, brainPausedUntil: Number.MAX_SAFE_INTEGER,
    study: { on: true, name: 'fixture', chunks: 0, lines: [] }, studyQueue: queue,
    evidence: { append(kind, row) { records.push({ kind, ...row }); return { id: 'saved' }; } },
    studyEmit() {}, emit() {}, brainFail() { return false; }, console,
  });
  vm.runInContext(server.slice(server.indexOf('async function studyChunk('), server.indexOf('// ---------- TRAINING SHOW:')), context);
  await context.studyChunk('fixture', 'audio/mpeg', 1234, 'audio-id');
  assert.equal(queue.buf.length, 1); assert.equal(queue.buf[0].who, 'UNKNOWN');
  assert.equal(records[0].evidenceId, 'audio-id'); assert.equal(records[0].t, 1234);
  assert.equal(records[0].transcriptionProvider, 'local-whisper-base');
});
