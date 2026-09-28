import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { startVoice } from './console.mjs';
import { Transcripts } from './transcripts.mjs';
import { buildAgent } from './pipeline.mjs';

async function apiFixture(t) {
  const order = [];
  const config = { app_id: 'app', token: 'short-lived', uid: '1001', agent_uid: '10000001', channel_name: 'test-channel' };
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/get_config') { res.end(JSON.stringify({ data: config })); return; }
    order.push('start');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    assert.deepEqual(JSON.parse(raw), { channelName: config.channel_name, rtcUid: 10000001, userUid: 1001 });
    res.end(JSON.stringify({ data: { agent_id: 'agent' } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { api: `http://127.0.0.1:${server.address().port}`, order, config };
}

test('native RTC joins before cloud start and smoke mode disables microphone', async (t) => {
  const f = await apiFixture(t);
  const audio = { async join(config, options) {
    assert.deepEqual(config, f.config);
    assert.equal(options.listenOnly, true);
    f.order.push('join');
  } };
  const session = await startVoice(f.api, audio, { listenOnly: true });
  assert.deepEqual(f.order, ['join', 'start']);
  assert.equal(session.agentId, 'agent');
  assert.equal(buildAgent({}, 'https://example.com/mcp', 'secret', { dataChannel: 'datastream' }).config.parameters.data_channel, 'datastream');
  assert.equal(buildAgent({}, 'https://example.com/mcp', 'secret').config.parameters.data_channel, 'rtm');
});

test('microphone/RTC failure cannot start a cloud agent', async (t) => {
  const f = await apiFixture(t);
  await assert.rejects(startVoice(f.api, { async join() { throw new Error('Permission denied'); } }), /Permission denied/);
  assert.deepEqual(f.order, []);
});

test('stop during native join cannot start a cloud agent afterwards', async (t) => {
  const f = await apiFixture(t);
  const abort = new AbortController();
  await assert.rejects(startVoice(f.api, { async join() { abort.abort(); } }, { signal: abort.signal }), { name: 'AbortError' });
  assert.deepEqual(f.order, []);
});

test('transcripts assemble UTF-8 out-of-order chunks and suppress duplicates and partials', () => {
  const lines = [];
  const t = new Transcripts((line) => lines.push(line));
  const message = { object: 'user.transcription', turn_id: 1, final: true, text: 'Open café ☕' };
  const payload = Buffer.from(JSON.stringify(message)).toString('base64');
  const middle = Math.floor(payload.length / 2);
  t.accept(`a|2|2|${payload.slice(middle)}`);
  t.accept(`a|1|???|${payload.slice(0, middle)}`);
  t.accept(JSON.stringify(message));
  t.accept(JSON.stringify({ ...message, final: false, text: 'partial' }));
  t.accept(JSON.stringify({ object: 'assistant.transcription', turn_id: 2, turn_status: 0, text: 'partial' }));
  t.accept('invalid');
  assert.deepEqual(lines, ['you> Open café ☕']);
});

test('transcripts expire incomplete messages and strip terminal control bytes', () => {
  const lines = [];
  const t = new Transcripts((line) => lines.push(line));
  t.accept('a|1|2|abcd', 0);
  t.accept('b|1|2|abcd', 31000);
  assert.equal(t.chunks.has('a'), false);
  t.accept(JSON.stringify({ object: 'assistant.transcription', turn_id: 1, turn_status: 1, text: '\u001b[2JDone\n' }));
  assert.equal(lines.length, 1);
  assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(lines[0]));
});
