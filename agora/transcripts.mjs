// RTC message framing and transcript fields follow Agora agent-client-toolkit 2.10.0.
// See SOURCES.md. Transcript text is display-only and is never used to execute actions.
export class Transcripts {
  constructor(write = console.log) { this.write = write; this.chunks = new Map(); this.last = new Map(); }
  accept(raw, now = Date.now()) {
    if (typeof raw !== 'string' || raw.length > 65536) return;
    for (const [key, value] of this.chunks) if (now - value.time > 30000) this.chunks.delete(key);
    let message;
    try {
      if (raw.trimStart().startsWith('{')) message = JSON.parse(raw);
      else {
        const parts = raw.split('|');
        if (parts.length !== 4) return;
        const [id, indexText, totalText, data] = parts;
        const index = Number(indexText), total = totalText === '???' ? -1 : Number(totalText);
        if (!Number.isInteger(index) || index < 1 || index > 1024 ||
          !Number.isInteger(total) || (total !== -1 && (total < index || total > 1024))) return;
        if (!this.chunks.has(id)) {
          if (this.chunks.size >= 100) this.chunks.delete(this.chunks.keys().next().value);
          this.chunks.set(id, { time: now, parts: new Map(), total: -1, bytes: 0 });
        }
        const chunk = this.chunks.get(id);
        if (!chunk.parts.has(index)) { chunk.parts.set(index, data); chunk.bytes += data.length; }
        if (chunk.bytes > 262144) { this.chunks.delete(id); return; }
        if (total !== -1) chunk.total = total;
        if (chunk.total < 1 || chunk.parts.size !== chunk.total) return;
        const ordered = Array.from({ length: chunk.total }, (_, i) => chunk.parts.get(i + 1));
        if (ordered.some((value) => value === undefined)) return;
        this.chunks.delete(id);
        message = JSON.parse(Buffer.from(ordered.join(''), 'base64').toString('utf8'));
      }
    } catch { return; }
    if (!['user.transcription', 'assistant.transcription'].includes(message?.object) || typeof message.text !== 'string') return;
    // Word-mode messages can update one turn repeatedly. Print completed segments only.
    if (message.turn_status === 0 || message.final === false) return;
    const key = `${message.object}:${message.turn_id}:${message.stream_id ?? ''}`;
    // Remove terminal escape/control characters from remote text.
    const text = message.text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
    if (!text || this.last.get(key) === text) return;
    this.last.set(key, text);
    if (this.last.size > 200) this.last.delete(this.last.keys().next().value);
    this.write(`${message.object === 'user.transcription' ? 'you' : 'agora'}> ${text}`);
  }
}
