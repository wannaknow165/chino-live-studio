// Freeze a bounded source packet for a human/chat reviewer; never call a cloud API.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalTranscriber } from '../local-transcriber.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(root, 'data', 'reviews', stamp);
fs.mkdirSync(out, { recursive: true });
const raw = fs.readFileSync(path.join(root, 'data', 'learning', 'observations.jsonl'), 'utf8');
const rows = raw.trim().split('\n').filter(Boolean).map(JSON.parse);
const packet = { createdAt: Date.now(), source: 'prettyboyali24', rows, backfill: [], skipped: [] };
const done = new Set(rows.filter(r => r.kind === 'transcript' && r.evidenceId).map(r => r.evidenceId));
const config = JSON.parse(fs.readFileSync(path.join(root, 'data', 'local-transcription-config.json'), 'utf8'));
const worker = new LocalTranscriber(path.join(root, '.venv-learning', 'Scripts', 'python.exe'), [path.join(root, 'tools', 'transcribe_local.py'), config.model]);
const todo = rows.filter(r => r.kind === 'capture' && r.file.endsWith('.mp3') && r.bytes > 3000 && !r.mayBePartial && !done.has(r.id));
try {
  for (const r of todo.slice(0, 60)) {
    try {
      const result = await worker.transcribe(fs.readFileSync(path.join(root, 'data', 'learning', r.file)).toString('base64'));
      packet.backfill.push({ evidenceId: r.id, capturedAt: r.capturedAt, status: 'unverified_transcript', ...result });
    } catch (e) { packet.skipped.push({ evidenceId: r.id, reason: e.message }); }
    fs.writeFileSync(path.join(out, 'source-packet.json'), JSON.stringify(packet, null, 2));
  }
  for (const r of todo.slice(60)) packet.skipped.push({ evidenceId: r.id, reason: 'batch_limit' });
  fs.writeFileSync(path.join(out, 'source-packet.json'), JSON.stringify(packet, null, 2));
  console.log(JSON.stringify({ directory: out, observations: rows.length, backfilled: packet.backfill.length, skipped: packet.skipped.length }));
} finally { worker.stop(); }
