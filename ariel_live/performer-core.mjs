import fs from 'node:fs';
import crypto from 'node:crypto';

export const EMOTIONS = ['neutral', 'warm', 'curious', 'amused', 'excited', 'focused', 'sympathetic'];
export const GAZES = ['camera', 'opponent', 'chat'];
export const decisionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['speak', 'wait', 'clarify'] },
    text: { type: 'string' }, language: { type: 'string', enum: ['he', 'en'] },
    emotion: { type: 'string', enum: EMOTIONS }, gaze: { type: 'string', enum: GAZES },
    ttlMs: { type: 'integer' }, reason: { type: 'string' },
  },
  required: ['action', 'text', 'language', 'emotion', 'gaze', 'ttlMs', 'reason'],
};
export function validateDecision(d) {
  if (!d || !['speak', 'wait', 'clarify'].includes(d.action) || typeof d.text !== 'string' ||
      !['he', 'en'].includes(d.language) || !EMOTIONS.includes(d.emotion) || !GAZES.includes(d.gaze) ||
      !Number.isFinite(d.ttlMs)) throw new Error('invalid_decision');
  if (d.text.length > 350) throw new Error('response_too_long');
  return { ...d, ttlMs: Math.max(5000, Math.min(30000, d.ttlMs)), reason: String(d.reason || '').slice(0, 160) };
}

// Conservative reservations, NOT a provider invoice. Failed/ambiguous requests
// remain reserved. Restarting never resets the user's cumulative ceiling.
export class Budget {
  constructor(file, limit = 100) {
    this.file = file; this.limit = Math.min(100, limit); this.entries = [];
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(saved.entries) || saved.entries.some(x => !Number.isFinite(x.usd) || x.usd < 0))
        throw new Error('budget_ledger_invalid');
      this.entries = saved.entries;
    }
  }
  reserve(kind, usd) {
    if (!Number.isFinite(usd) || usd <= 0) throw new Error('invalid_reservation');
    if (this.status().reservedUSD + usd > this.limit) throw new Error('budget_limit');
    const id = crypto.randomUUID();
    this.entries.push({ id, kind, usd, at: Date.now(), state: 'reserved' });
    try { this.save(); } catch (e) { this.entries.pop(); throw e; }
    return id;
  }
  finish(id, usage) {
    const row = this.entries.find(x => x.id === id);
    if (row) { row.state = 'completed'; if (usage) row.tokens = usage; this.save(); }
  }
  save() { fs.writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, entries: this.entries })); fs.renameSync(this.file + '.tmp', this.file); }
  status() { return { limitUSD: this.limit, reservedUSD: +this.entries.reduce((n, e) => n + e.usd, 0).toFixed(4), requests: this.entries.length, accounting: 'conservative_reservations_not_invoice' }; }
}

export class Performer {
  constructor({ decide, voice, emit, stageReady, now = Date.now }) {
    Object.assign(this, { decide, voice, emit, stageReady, now });
    this.mode = 'manual'; this.phase = 'idle'; this.epoch = 0; this.pending = null;
    this.controller = null; this.otherSpeaking = false; this.externalClip = false;
    this.queue = []; this.history = []; this.seen = new Map(); this.lastReplyAt = 0;
    this.error = ''; this.room = ''; this.lastDecision = null; this.deadline = null;
    this.timing = null;
  }
  status() {
    return { mode: this.mode, phase: this.phase, epoch: this.epoch, pending: this.pending,
      opponentSpeaking: this.otherSpeaking, externalClip: this.externalClip,
      queue: this.queue.length, error: this.error, room: this.room, lastDecision: this.lastDecision, timing:this.timing };
  }
  publish() { this.emit('performer-state', this.status()); }
  cancel(reason = 'operator_stop') {
    this.epoch++; this.controller?.abort(); this.controller = null; clearTimeout(this.deadline);
    this.queue = []; this.pending = null; this.phase = 'idle';
    this.emit('cancel', { epoch: this.epoch, reason }); this.publish();
  }
  setMode(mode) {
    if (!['manual', 'auto', 'paused'].includes(mode)) throw new Error('invalid_mode');
    this.cancel('mode_changed'); this.mode = mode; this.error = ''; this.publish();
  }
  setRoom(room) {
    const value = String(room || '').replace(/^@/, '').trim().toLowerCase();
    if (value !== this.room) { this.cancel('room_changed'); this.room = value; this.history = []; this.seen.clear(); }
    this.publish();
  }
  speaking(on) {
    if (on && !this.otherSpeaking) this.cancel('opponent_speaking');
    this.otherSpeaking = !!on; this.publish();
  }
  clip(on) {
    this.cancel(on ? 'external_clip_started' : 'external_clip_ended');
    this.externalClip = !!on; this.publish();
  }
  stop() { this.mode = 'paused'; this.cancel('emergency_stop'); }
  validEvent(e) {
    if (!e || !['chat', 'gift', 'follow', 'opponent', 'battle', 'join'].includes(e.kind)) return false;
    if (typeof e.text !== 'string' || !e.text.trim() || e.text.length > 1500) return false;
    return Number.isFinite(e.at) && this.now() - e.at <= 30000 && e.at - this.now() <= 2000;
  }
  ingest(e) {
    if (!this.validEvent(e) || e.source !== 'live' || !this.room || e.room?.toLowerCase() !== this.room) return false;
    if (e.kind === 'battle' && e.ended) this.cancel('battle_ended');
    const id = e.id || [e.kind, e.name, e.text].join('|');
    if (this.seen.has(id) && this.now() - this.seen.get(id) < 30000) return false;
    this.seen.set(id, this.now()); if (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value);
    if (this.mode !== 'auto' || this.externalClip || this.otherSpeaking || e.kind === 'join') return false;
    if (e.kind === 'chat' && !/[\p{L}\p{N}]/u.test(e.text)) return false;
    this.queue.push(e); if (this.queue.length > 12) this.queue.shift(); return true;
  }
  async tick() {
    if (this.mode !== 'auto' || this.phase !== 'idle' || !this.queue.length ||
        this.otherSpeaking || this.externalClip || this.now() - this.lastReplyAt < 4500 || !this.stageReady()) return;
    this.queue = this.queue.filter(e => this.validEvent(e));
    const event = this.queue.find(e => e.kind === 'opponent') || this.queue.at(-1);
    this.queue = []; if (event) await this.respond(event);
  }
  async respond(event) {
    if (!this.validEvent(event)) throw new Error('stale_or_invalid_event');
    if (this.mode === 'paused' || this.otherSpeaking || this.externalClip) throw new Error('speech_held');
    if (this.phase !== 'idle') throw new Error('performer_busy');
    if (!this.stageReady()) throw new Error('stage_audio_not_ready');
    const epoch = this.epoch; const ctrl = this.controller = new AbortController();
    const startedAt=this.now(); this.timing={inputAt:event.at,startedAt,decisionMs:null,voiceMs:null,playbackStartMs:null};
    this.phase = 'thinking'; this.error = ''; this.publish();
    try {
      const d = validateDecision(await this.decide(event, this.history.slice(-10), ctrl.signal));
      if (epoch !== this.epoch) return { cancelled: true };
      this.timing.decisionMs=this.now()-startedAt;
      this.lastDecision = d;
      if (d.action === 'wait' || !d.text.trim()) { this.phase = 'idle'; this.publish(); return d; }
      const deadline = Math.min(event.at + 30000, this.now() + d.ttlMs);
      const voiceAt=this.now(); const audio = await this.voice(d.text, d.language, ctrl.signal);
      if (epoch !== this.epoch || this.now() > deadline || this.otherSpeaking || !this.stageReady()) {
        if (epoch === this.epoch) { this.phase = 'idle'; this.publish(); }
        return { cancelled: true, reason: 'stale_or_interrupted' };
      }
      this.timing.voiceMs=this.now()-voiceAt;
      this.play({ ...d, ...audio }, epoch, deadline);
      this.history.push({ input: event.text, speaker: event.name || event.kind, reply: d.text });
      this.history = this.history.slice(-10); return d;
    } catch (e) {
      if (epoch === this.epoch) { this.phase = 'idle'; this.error = e.message; this.publish(); }
      if (e.name !== 'AbortError') throw e;
      return { cancelled: true };
    } finally { if (epoch === this.epoch) this.controller = null; }
  }
  async say(text, language = 'he') {
    text = String(text || '').trim();
    if (!text || text.length > 350) throw new Error('text_length_1_to_350');
    if (this.mode === 'paused' || this.externalClip) throw new Error('speech_held');
    if (!this.stageReady()) throw new Error('stage_audio_not_ready');
    this.cancel('operator_override');
    const epoch = this.epoch; const ctrl = this.controller = new AbortController();
    const startedAt=this.now();this.timing={inputAt:startedAt,startedAt,decisionMs:0,voiceMs:null,playbackStartMs:null};
    this.phase = 'preparing'; this.error = ''; this.publish();
    try {
      const audio = await this.voice(text, language, ctrl.signal);
      if (epoch !== this.epoch || !this.stageReady()) {
        if (epoch === this.epoch) { this.phase = 'idle'; this.publish(); }
        return { cancelled: true };
      }
      this.timing.voiceMs=this.now()-startedAt;
      this.play({ text, language, ...audio, emotion: 'warm', gaze: 'camera' }, epoch, this.now() + 15000);
      return { accepted: true };
    } catch (e) {
      if (epoch === this.epoch) { this.phase = 'idle'; this.error = e.message; this.publish(); }
      if (e.name !== 'AbortError') throw e; return { cancelled: true };
    } finally { if (epoch === this.epoch) this.controller = null; }
  }
  play(payload, epoch, expiresAt) {
    const id = crypto.randomUUID(); this.pending = { id, epoch, expiresAt, text: payload.text };
    this.phase = 'queued'; this.lastReplyAt = this.now();
    this.emit('utterance', { ...payload, id, epoch, expiresAt }); this.publish();
    this.deadline = setTimeout(() => {
      if (this.pending?.id === id) { this.error = 'playback_timeout'; this.cancel('playback_timeout'); }
    }, 60000);
    this.deadline.unref?.();
  }
  ack(id, epoch, state) {
    if (!this.pending || this.pending.id !== id || epoch !== this.epoch) return false;
    if (state === 'started') {this.phase = 'speaking';if(this.timing)this.timing.playbackStartMs=this.now()-this.timing.inputAt;}
    else if (['ended', 'error', 'cancelled'].includes(state)) {
      clearTimeout(this.deadline); this.pending = null; this.phase = 'idle';
      if (state === 'error') this.error = 'stage_playback_error';
    } else return false;
    this.publish(); return true;
  }
}
