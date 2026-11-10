import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const normalized = s => String(s).normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
export function run(command, args, signal, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], signal });
    let tail = ''; const timer = setTimeout(() => child.kill(), timeout);
    child.stderr.on('data', b => { tail = (tail + b.toString()).slice(-1500); });
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('local_audio_tool_failed_' + code)); });
  });
}
export class OriginalVoice {
  constructor({ bankFile, bankDir, audioDir, rhubarb }) {
    Object.assign(this, { bankFile, bankDir, audioDir, rhubarb });
    this.pending = new Map(); fs.mkdirSync(audioDir, { recursive: true });
  }
  catalog() {
    return JSON.parse(fs.readFileSync(this.bankFile, 'utf8')).filter(x => /^[a-f0-9]{10}\.mp4$/.test(x.file) && fs.existsSync(path.join(this.bankDir, x.file)))
      .map(x => ({ id: x.id, text: x.text, language: /[א-ת]/.test(x.text) ? 'he' : 'en' }));
  }
  status() { return { voice: 'original_gemini_bank', freeText: false, phonemes: fs.existsSync(this.rhubarb), clips: this.catalog().length }; }
  async voice(text, language, signal) {
    const item = this.catalog().find(x => normalized(x.text) === normalized(text));
    if (!item) throw new Error('original_voice_phrase_unavailable');
    const id = crypto.createHash('sha256').update('original-gemini-v2-trim|' + item.id).digest('hex');
    const audio = path.join(this.audioDir, id + '.wav'), cueFile = path.join(this.audioDir, id + '.json');
    if (!fs.existsSync(audio) || !fs.existsSync(cueFile)) {
      if (!this.pending.has(id)) this.pending.set(id, this.prepare(item, audio, cueFile, signal).finally(() => this.pending.delete(id)));
      await this.pending.get(id);
    }
    signal?.throwIfAborted();
    const cues = JSON.parse(fs.readFileSync(cueFile, 'utf8'));
    return { text: item.text, audioUrl: '/audio/' + id + '.wav', voice: 'original_gemini_bank', bankId: item.id,
      lipSync: 'rhubarb_phonetic_audio_timeline', duration: cues.metadata.duration, mouthCues: cues.mouthCues };
  }
  async prepare(item, audio, cueFile, signal) {
    if (!fs.existsSync(this.rhubarb)) throw new Error('phoneme_engine_missing');
    // Rhubarb's Windows executable cannot resolve Unicode paths. Isolate its
    // finite working files in an ASCII temp directory; never alter the source.
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lion-voice-'));
    try {
      const wav = path.join(temp, 'voice.wav'), cues = path.join(temp, 'cues.json');
      await run('ffmpeg', ['-v','error','-y','-i',path.join(this.bankDir,item.id+'.mp4'),'-t','45','-vn','-af','silenceremove=start_periods=1:start_duration=0.04:start_threshold=-42dB:stop_periods=1:stop_duration=1.5:stop_threshold=-48dB','-ar','48000','-ac','2','-c:a','pcm_s16le',wav], signal);
      await run(this.rhubarb, ['-r','phonetic','-f','json','--extendedShapes','GHX','-o',cues,wav], signal);
      const data = JSON.parse(fs.readFileSync(cues,'utf8'));
      if (!Number.isFinite(data.metadata?.duration) || data.metadata.duration > 45.1 || !Array.isArray(data.mouthCues) ||
          data.mouthCues.some(c => !/^[A-HX]$/.test(c.value) || !Number.isFinite(c.start) || c.end < c.start)) throw new Error('invalid_mouth_cues');
      delete data.metadata.soundFile;
      fs.copyFileSync(wav, audio + '.tmp'); fs.renameSync(audio + '.tmp',audio);
      fs.writeFileSync(cueFile+'.tmp', JSON.stringify(data)); fs.renameSync(cueFile+'.tmp',cueFile);
    } finally { fs.rmSync(temp,{recursive:true,force:true}); }
  }
}
