import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export class MacWorker {
  constructor(root) {
    this.pending = new Map();
    this.child = spawn(resolve(root, '.venv/bin/python'), ['-m', 'macbrow.agora_bridge'], {
      cwd: root, stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.ready = new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(() => {
        rejectReady(new Error('Mac worker startup timed out'));
        this.close();
      }, 15000);
      const fail = () => {
        clearTimeout(timer);
        const error = new Error('Mac worker exited. Check TYPESAFE_API_KEY and the Python log.');
        rejectReady(error);
        for (const { reject, timer } of this.pending.values()) {
          clearTimeout(timer);
          reject(error);
        }
        this.pending.clear();
      };
      this.child.once('error', fail);
      this.child.once('exit', fail);
      createInterface({ input: this.child.stdout }).on('line', (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.ready) {
          clearTimeout(timer);
          resolveReady();
        }
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error));
          else pending.resolve(message);
        }
      });
    });
  }

  async run(utterance) {
    await this.ready;
    const id = randomUUID();
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Mac action timed out; its outcome is unknown. Do not retry automatically.'));
        this.close();
      }, 105000);
      this.pending.set(id, { resolve: resolveResult, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, utterance }) + '\n', (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  close() {
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
    }, 3000);
    timer.unref();
  }
}
