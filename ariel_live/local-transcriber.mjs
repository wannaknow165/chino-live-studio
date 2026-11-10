import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class LocalTranscriber {
  constructor(command, args, timeoutMs = 45000) {
    this.command = command; this.args = args; this.timeoutMs = timeoutMs;
    this.pending = new Map(); this.nextId = 0; this.proc = null;
    this.completed = 0; this.error = ''; this.retryAfter = 0;
  }
  start() {
    if (this.proc) return;
    if (Date.now() < this.retryAfter) throw new Error('Local transcription restarting');
    const p = this.proc = spawn(this.command, this.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const fail = () => {
      if (this.proc !== p) return;
      this.proc = null; this.retryAfter = Date.now() + 30000;
      this.error = 'local_worker_stopped';
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error(this.error)); }
      this.pending.clear();
    };
    p.on('error', fail); p.on('exit', fail); p.stdin.on('error', fail);
    createInterface({ input: p.stdout }).on('line', line => {
      let result; try { result = JSON.parse(line); } catch { return; }
      const item = this.pending.get(result.id); if (!item) return;
      this.pending.delete(result.id); clearTimeout(item.timer);
      if (result.error) { this.error = result.error; this.errorDetail=result.detail||''; item.reject(new Error(result.error)); }
      else { this.completed++; this.error = ''; this.errorDetail=''; item.resolve(result); }
    });
  }
  transcribe(b64, options = {}) {
    if (this.pending.size >= 4) return Promise.reject(new Error('Local transcription busy; audio remains archived'));
    try { this.start(); } catch (e) { return Promise.reject(e); }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.proc?.kill(); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, b64, language: options.language, initialPrompt: options.initialPrompt }) + '\n');
    });
  }
  status() { return { running: !!this.proc, pending: this.pending.size, completed: this.completed, error: this.error, detail:this.errorDetail||'' }; }
  stop() { this.proc?.kill(); }
}
