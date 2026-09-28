import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

export class NativeAudio extends EventEmitter {
  constructor(root) {
    super();
    this.child = spawn(resolve(root, '.agora-demo/MacbrowAudio.app/Contents/MacOS/MacbrowAudio'), [], {
      cwd: root, stdio: ['pipe', 'pipe', 'inherit'],
      // Only short-lived RTC credentials cross stdin. Do not inherit backend API keys.
      env: Object.fromEntries(['HOME', 'TMPDIR', 'PATH', 'LANG', 'LC_ALL']
        .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])),
    });
    this.closed = new Promise((resolveClosed) => {
      this.child.once('error', () => {
        this.failure(new Error('Native audio helper could not launch. Run ./console.sh setup.'));
        resolveClosed();
      });
      this.child.once('exit', (code) => {
        if (!this.stopping) this.failure(new Error(`Native audio helper exited (code ${code ?? 'signal'}).`));
        resolveClosed();
      });
    });
    this.child.stdin.on('error', () => {
      if (!this.stopping) this.failure(new Error('Native audio connection closed.'));
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; } // SDK diagnostic lines are not protocol messages.
      if (message.event === 'joined') { clearTimeout(this.joinTimer); this.resolveJoin?.(); }
      if (message.event === 'error') this.failure(new Error(message.message));
      this.emit('message', message);
    });
  }
  failure(error) {
    clearTimeout(this.joinTimer);
    this.rejectJoin?.(error);
    this.emit('failure', error);
  }
  send(message) {
    if (!this.stopping && !this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  join(config, { listenOnly = false } = {}) {
    return new Promise((resolveJoin, rejectJoin) => {
      this.resolveJoin = resolveJoin;
      this.rejectJoin = rejectJoin;
      this.joinTimer = setTimeout(() => this.failure(new Error('RTC join timed out. Check microphone permission and connectivity.')), 90000);
      this.send({ command: 'join', ...config, listenOnly });
    });
  }
  async close() {
    if (!this.stopping) {
      this.send({ command: 'stop' });
      this.stopping = true;
      clearTimeout(this.joinTimer);
      this.rejectJoin?.(new Error('Voice console stopped.'));
      this.child.stdin.end();
      this.killTimer = setTimeout(() => this.child.kill('SIGKILL'), 5000);
      this.killTimer.unref();
    }
    await this.closed;
    clearTimeout(this.killTimer);
  }
}
