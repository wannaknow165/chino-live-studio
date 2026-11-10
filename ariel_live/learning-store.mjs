import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Renderer-independent observations. Model interpretations remain hypotheses.
export const SITUATIONS = ['opening', 'warmup', 'battle_start', 'battle_winning',
  'battle_losing', 'battle_last_30s', 'battle_won', 'battle_lost', 'battle_tied',
  'gift', 'greeting', 'question', 'teasing', 'disagreement', 'joke',
  'followup', 'repair_misunderstanding', 'lull', 'interruption', 'disconnect'];

export class LearningStore {
  constructor(root, maxBytes = 512 * 1024 * 1024) {
    this.root = root; this.maxBytes = maxBytes; this.bytes = 0;
    this.error = ''; this.session = randomUUID(); this.records = 0;
    fs.mkdirSync(root, { recursive: true });
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile()) this.bytes += fs.statSync(path.join(root, entry.name)).size;
    }
  }
  append(kind, data) {
    const row = { ...data, id: randomUUID(), session: this.session, kind, recordedAt: Date.now() };
    const line = JSON.stringify(row) + '\n';
    if (this.bytes + Buffer.byteLength(line) > this.maxBytes) {
      this.error = 'storage_limit'; return null;
    }
    try {
      fs.appendFileSync(path.join(this.root, 'observations.jsonl'), line);
      this.bytes += Buffer.byteLength(line); this.records++; return row;
    } catch { this.error = 'storage_write_failed'; return null; }
  }
  capture(buf, extension, metadata) {
    if (!['mp3', 'jpg'].includes(extension)) throw new Error('Unsupported evidence format');
    // Reserve space for the manifest; never delete old evidence silently.
    if (this.bytes + buf.length + 4096 > this.maxBytes) {
      this.error = 'storage_limit'; return null;
    }
    const file = `${randomUUID()}.${extension}`;
    try {
      fs.writeFileSync(path.join(this.root, file), buf, { flag: 'wx' });
      this.bytes += buf.length;
      return this.append('capture', { ...metadata, file, bytes: buf.length });
    } catch { this.error = 'storage_write_failed'; return null; }
  }
  status() { return { bytes: this.bytes, maxBytes: this.maxBytes, error: this.error, recordsThisRun: this.records }; }
}

// Dequeue only the exact rows successfully analyzed; concurrent arrivals stay queued.
export async function analyzeBatch(owner, analyze, commit, {maxRows=100}={}) {
  if (owner.analyzing || !owner.buf.length) return false;
  owner.analyzing = true;
  const batch = owner.buf.slice(0,Math.max(1,Math.min(100,Math.floor(maxRows)||100)));
  try {
    const result = await analyze(batch);
    await commit(result, batch);
    const done = new Set(batch);
    owner.buf = owner.buf.filter(row => !done.has(row));
    return true;
  } finally { owner.analyzing = false; }
}

export function transcriptRows(lines, context) {
  return (Array.isArray(lines) ? lines : []).filter(l => typeof l?.text === 'string' && l.text.trim().length > 1)
    .map(l => ({ ...context, t: context.capturedAt, processedAt: Date.now(),
      segmentStart: Number.isFinite(l.start) ? l.start : null, segmentEnd: Number.isFinite(l.end) ? l.end : null,
      timing: 'capture_end_approximate', who: ['HOST', 'OTHER'].includes(l.who) ? l.who : 'UNKNOWN', text: l.text.trim() }));
}

export function classifyProviderFailure(message) {
  if (/depleted|billing|prepayment|insufficient.*credit/i.test(message)) return 'billing';
  if (/quota|rate.?limit|429|RESOURCE_EXHAUSTED/i.test(message)) return 'quota';
  return '';
}
