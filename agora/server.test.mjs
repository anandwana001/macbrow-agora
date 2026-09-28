import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { authorized, checkLocalRequest, createDemo } from './server.mjs';
import { buildAgent } from './pipeline.mjs';

async function fixture(t, overrides = {}) {
  const calls = [];
  const workers = [];
  const sessions = [];
  let secret;
  const demo = createDemo({
    appId: 'a'.repeat(32), appCertificate: 'b'.repeat(32), endpoint: 'https://example.com/mcp',
    tokenFactory: () => 'fake-token',
    workerFactory: () => {
      const worker = { ready: Promise.resolve(), closed: false, close() { this.closed = true; },
        async run(utterance) {
          calls.push(utterance);
          await new Promise((r) => setTimeout(r, 5));
          return { speak: 'Done', executed: true };
        }, ...overrides.worker };
      workers.push(worker);
      return worker;
    },
    sessionFactory: (current) => {
      secret = current.secret;
      const session = { status: 'idle', async start() { this.status = 'running'; return 'agent-test'; },
        async stop() { this.status = 'stopped'; }, ...overrides.session };
      sessions.push(session);
      return session;
    },
  });
  demo.control.listen(0, '127.0.0.1');
  demo.mcp.listen(0, '127.0.0.1');
  await Promise.all([once(demo.control, 'listening'), once(demo.mcp, 'listening')]);
  t.after(() => demo.close());
  const api = `http://127.0.0.1:${demo.control.address().port}`;
  const mcp = `http://127.0.0.1:${demo.mcp.address().port}`;
  const post = (path, body) => fetch(api + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const config = (await (await fetch(api + '/get_config')).json()).data;
  const start = () => post('/startAgent', { channelName: config.channel_name, rtcUid: +config.agent_uid, userUid: +config.uid });
  const tool = async (id, utterance, token = secret) => {
    const response = await fetch(mcp + '/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'run_mac_command', arguments: { turn_id: String(id), utterance } } }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { demo, api, mcp, post, config, start, tool, workers, sessions, calls, secret: () => secret };
}

test('managed pipeline uses MCP while leaving all vendor API keys omitted', () => {
  const config = buildAgent({}, 'https://example.com/mcp', 'session-secret').config;
  assert.equal(config.llm.params.model, 'gpt-4o-mini');
  assert.equal(config.llm.api_key, undefined);
  assert.equal(config.stt.api_key, undefined);
  assert.equal(config.tts.api_key, undefined);
  assert.equal(config.llm.mcp_servers[0].headers.Authorization, 'Bearer session-secret');
  assert.deepEqual(config.llm.mcp_servers[0].allowed_tools, ['run_mac_command']);
  assert.equal(config.advancedFeatures.enable_tools, true);
});

test('control API rejects untrusted origins and hosts', () => {
  assert.throws(() => checkLocalRequest({ headers: { host: 'attacker.example' } }));
  assert.throws(() => checkLocalRequest({ headers: { host: 'localhost:8000', origin: 'https://attacker.example' } }));
  assert.doesNotThrow(() => checkLocalRequest({ headers: { host: 'localhost:8000', origin: 'http://localhost:3000' } }));
  assert.equal(authorized('Bearer right', 'right'), true);
  assert.equal(authorized('Bearer wrong', 'right'), false);
  assert.equal(authorized(undefined, 'right'), false);
  assert.equal(authorized('Bearer ', ''), false);
});

test('tools require a live session, matching bearer token, and valid arguments', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.tool(1, 'open Chrome', 'guess')).status, 401);
  assert.equal((await f.start()).status, 200);
  assert.equal((await f.tool(1, 'open Chrome', 'guess')).status, 401);
  const result = await f.tool(1, 'open Chrome');
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body.result.content[0].text).executed, true);
  const invalid = await f.tool(2, '');
  assert.ok(invalid.body.error || invalid.body.result?.isError);
  assert.deepEqual(f.calls, ['open Chrome']);
});

test('confirmation turns retain the same worker; retries cannot replay actions', async (t) => {
  const f = await fixture(t);
  await f.start();
  await Promise.all([f.tool(1, 'open Chrome'), f.tool(1, 'open Chrome')]);
  await f.tool(2, 'yes');
  const conflict = await f.tool(2, 'a different action');
  assert.equal(conflict.body.result.isError, true);
  assert.deepEqual(f.calls, ['open Chrome', 'yes']);
  assert.equal(f.workers.length, 1);
  assert.equal((await f.start()).status, 409);
});

test('stop revokes MCP access, closes worker, and allows a new session', async (t) => {
  const f = await fixture(t);
  await f.start();
  const old = f.secret();
  assert.equal((await f.post('/stopAgent', { agentId: 'not-owned' })).status, 403);
  assert.equal((await f.post('/stopAgent', { agentId: 'agent-test' })).status, 200);
  assert.equal(f.workers[0].closed, true);
  assert.equal(f.sessions[0].status, 'stopped');
  assert.equal((await f.tool(3, 'yes', old)).status, 401);
  await f.start();
  assert.notEqual(f.secret(), old);
  assert.equal((await f.tool(4, 'yes', old)).status, 401);
});

test('failed cloud startup closes the worker and releases the Mac', async (t) => {
  const f = await fixture(t, { session: { async start() { throw new Error('cloud unavailable'); } } });
  assert.equal((await f.start()).status, 500);
  assert.equal(f.workers[0].closed, true);
  assert.equal((await f.tool(1, 'open Chrome')).status, 401);
  assert.equal((await fetch(f.api + '/get_config')).status, 200);
});

test('token renewal cannot mint credentials for an unknown channel or user', async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.api + '/get_config?channel=foreign&uid=1')).status, 403);
  const renewal = await fetch(f.api + `/get_config?channel=${f.config.channel_name}&uid=${f.config.uid}`);
  assert.equal(renewal.status, 200);
  assert.equal((await renewal.json()).data.agent_uid, f.config.agent_uid);
});

test('uncertain tool failures are not replayed on retry', async (t) => {
  let attempts = 0;
  const f = await fixture(t, { worker: { async run() { attempts++; throw new Error('timeout'); } } });
  await f.start();
  assert.equal((await f.tool(1, 'open Chrome')).body.result.isError, true);
  assert.equal((await f.tool(1, 'open Chrome')).body.result.isError, true);
  assert.equal(attempts, 1);
});

test('failed cloud stop revokes tools immediately and supports a later stop retry', async (t) => {
  let attempts = 0;
  const f = await fixture(t, { session: { async stop() {
    if (++attempts === 1) throw new Error('network unavailable');
    this.status = 'stopped';
  } } });
  await f.start();
  const old = f.secret();
  assert.equal((await f.post('/stopAgent', { agentId: 'agent-test' })).status, 500);
  assert.equal((await f.tool(1, 'open Chrome', old)).status, 401);
  assert.equal((await f.post('/stopAgent', { agentId: 'agent-test' })).status, 200);
  assert.equal(f.workers[0].closed, true);
});
