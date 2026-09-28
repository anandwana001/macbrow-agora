import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AgoraClient, Area, generateConvoAIToken } from 'agora-agents';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { buildAgent } from './pipeline.mjs';
import { MacWorker } from './worker.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (status, message) => Object.assign(new Error(message), { status });
const reply = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Expected application/json');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw fail(413, 'Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'Invalid JSON'); }
}

export function checkLocalRequest(req) {
  const host = req.headers.host?.split(':')[0];
  if (!['localhost', '127.0.0.1'].includes(host)) throw fail(403, 'Local requests only');
  if (req.headers.origin && !['http://localhost:3000', 'http://127.0.0.1:3000'].includes(req.headers.origin)) {
    throw fail(403, 'Untrusted origin');
  }
}

export function authorized(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const supplied = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createDemo({ appId, appCertificate, endpoint, root = ROOT,
  workerFactory = () => new MacWorker(root), sessionFactory, tokenFactory = generateConvoAIToken,
  dataChannel = 'rtm', onAction = () => {} } = {}) {
  if (!appId || !appCertificate) throw new Error('Configure Agora credentials in .env.agora');
  if (!endpoint) throw new Error('Set MACBROW_MCP_URL in .env.agora to your HTTPS tunnel URL with /mcp appended');
  if (new URL(endpoint).protocol !== 'https:') throw new Error('MACBROW_MCP_URL must be an HTTPS endpoint ending in /mcp');
  if (new URL(endpoint).pathname !== '/mcp') throw new Error('MACBROW_MCP_URL must end in /mcp');
  const client = sessionFactory ? null : new AgoraClient({ appId, appCertificate, area: Area.US });
  let issued = null;
  let active = null;
  let closing = false;

  async function stop() {
    const current = active;
    if (!current) return;
    if (current.stopPromise) return current.stopPromise;
    current.stopping = true;
    current.secret = ''; // revoke local Mac access before the cloud stop request
    current.worker.close();
    clearTimeout(current.expiry);
    clearTimeout(current.goodbye);
    current.stopPromise = (async () => {
      try {
        // A stop arriving during start waits for the SDK's lifecycle transition.
        await current.started;
        clearTimeout(current.expiry);
        if (current.agentId) await current.session.stop();
        if (active === current) active = null;
      } catch (error) {
        // Retain failed cloud stops so the UI/shutdown can retry them.
        current.stopPromise = null;
        if (!current.agentId && active === current) active = null;
        throw error;
      }
    })();
    return current.stopPromise;
  }

  async function execute(current, { turn_id: turnId, utterance }) {
    if (active !== current || current.stopping) throw fail(410, 'Conversation ended');
    const previous = current.turns.get(turnId);
    if (previous) {
      if (previous.utterance !== utterance) throw fail(409, 'Use a new turn_id for a new user utterance');
      return previous.result;
    }
    if (current.turns.size >= 200) throw fail(409, 'Start a new conversation to continue');
    const result = current.queue.then(async () => {
      if (active !== current || current.stopping) throw fail(410, 'Conversation ended');
      const outcome = await current.worker.run(utterance);
      onAction({ utterance, ...outcome });
      if (outcome.stop) {
        current.stopping = true;
        current.goodbye = setTimeout(() => stop().catch(logError), 5000);
      }
      return outcome;
    });
    // Failed/uncertain actions are cached too: never replay side effects on retries.
    current.turns.set(turnId, { utterance, result });
    current.queue = result.catch(() => {});
    return result;
  }

  const control = createServer(async (req, res) => {
    try {
      checkLocalRequest(req);
      if (closing) throw fail(503, 'Shutting down');
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        return reply(res, 200, { ok: true, active: !!active, pipeline: 'Agora managed STT/LLM/TTS' });
      }
      if (req.method === 'GET' && url.pathname === '/get_config') {
        const channel = url.searchParams.get('channel');
        const uid = url.searchParams.get('uid');
        if (channel) {
          const known = active?.config ?? issued;
          if (!known || channel !== known.channel_name || uid !== known.uid) throw fail(403, 'Unknown conversation');
          issued = known;
        } else {
          if (active) throw fail(409, 'End the current conversation first');
          issued = {
            channel_name: `macbrow-${randomUUID()}`, uid: String(randomInt(1000, 9999999)),
            agent_uid: String(randomInt(10000000, 99999999)),
          };
        }
        const token = tokenFactory({ appId, appCertificate, channelName: issued.channel_name,
          uid: Number(issued.uid), tokenExpire: 3600 });
        return reply(res, 200, { code: 0, msg: 'success', data: { ...issued, app_id: appId, token } });
      }
      if (req.method === 'POST' && url.pathname === '/startAgent') {
        const body = await readJson(req);
        if (!issued || body.channelName !== issued.channel_name || String(body.rtcUid) !== issued.agent_uid ||
          String(body.userUid) !== issued.uid) throw fail(400, 'Get connection configuration first');
        if (active) throw fail(409, 'A conversation is already active');
        const current = {
          config: { ...issued }, secret: randomBytes(32).toString('hex'),
          worker: workerFactory(), turns: new Map(), queue: Promise.resolve(), stopping: false,
        };
        active = current; // reserve the Mac before awaiting startup
        current.started = (async () => {
          await current.worker.ready;
          current.session = sessionFactory ? sessionFactory(current) : buildAgent(client, endpoint, current.secret, { dataChannel })
            .createSession({ channel: issued.channel_name, agentUid: issued.agent_uid,
              remoteUids: [issued.uid], idleTimeout: 30, expiresIn: 3600 });
          current.agentId = await current.session.start();
          current.expiry = setTimeout(() => stop().catch(logError), 30 * 60 * 1000);
        })();
        try {
          await current.started;
        } catch (error) {
          current.worker.close();
          current.secret = '';
          if (active === current) active = null;
          throw error;
        }
        return reply(res, 200, { code: 0, msg: 'success', data: { agent_id: current.agentId } });
      }
      if (req.method === 'POST' && url.pathname === '/stopAgent') {
        const body = await readJson(req);
        if (active && body.agentId !== active.agentId) throw fail(403, 'Unknown agent');
        await stop();
        return reply(res, 200, { code: 0, msg: 'success' });
      }
      throw fail(404, 'Not found');
    } catch (error) {
      logError(error);
      reply(res, error.status ?? 500, { detail: error.status || error.message?.startsWith('Mac worker') ? error.message :
        'Could not start/stop the demo. Check the server log and configured keys.' });
    }
  });

  // Only this server is tunneled to Agora. It has no token/start/stop endpoints.
  const mcp = createServer(async (req, res) => {
    const current = active;
    if (!current || current.stopping || !authorized(req.headers.authorization, current.secret)) {
      return reply(res, 401, { error: 'Unauthorized' });
    }
    if (req.url !== '/mcp') return reply(res, 404, { error: 'Not found' });
    if (req.method !== 'POST') return reply(res, 405, { error: 'Use POST' });
    let server, transport;
    try {
      const body = await readJson(req);
      server = new McpServer({ name: 'macbrow', version: '1.0.0' });
      server.registerTool('run_mac_command', {
        description: 'Run the user’s exact Mac command or answer to a pending confirmation through Jev and the Mac safety policy. Never invent a confirmation. Reuse turn_id only for retries of the same user turn.',
        inputSchema: {
          utterance: z.string().trim().min(1).max(4000),
          turn_id: z.string().min(1).max(100),
        },
      }, async (args) => {
        try {
          const result = await execute(current, args);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          logError(error);
          return { isError: true, content: [{ type: 'text', text: 'The Mac action failed or its outcome is unknown. Do not retry automatically or claim success.' }] };
        }
      });
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        transport.close().catch(logError);
        server.close().catch(logError);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      logError(error);
      if (!res.headersSent) reply(res, error.status ?? 500, { error: 'MCP request failed' });
      await transport?.close();
      await server?.close();
    }
  });

  return { control, mcp, stop, async close() {
    closing = true;
    try { await stop(); } finally {
      for (const server of [control, mcp]) {
        server.close();
        server.closeAllConnections();
      }
    }
  } };
}

function logError(error) {
  // SDK error bodies may contain full request configs, including credentials.
  console.error(`[macbrow] ${error.name ?? 'Error'} (status ${error.status ?? error.statusCode ?? 'unknown'})`);
  if (error.message?.startsWith('Mac worker')) console.error(error.message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const file of ['.env.agora', '.env.local']) {
    try { process.loadEnvFile(resolve(ROOT, file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const demo = createDemo({ appId: process.env.AGORA_APP_ID, appCertificate: process.env.AGORA_APP_CERTIFICATE,
    endpoint: process.env.MACBROW_MCP_URL });
  demo.control.listen(8000, '127.0.0.1', () => console.log('Local Agora control API: http://127.0.0.1:8000'));
  demo.mcp.listen(8101, '127.0.0.1', () => console.log('MCP tool endpoint: http://127.0.0.1:8101/mcp (tunnel this port only)'));
  for (const server of [demo.control, demo.mcp]) server.on('error', (error) => {
    console.error(error.message);
    demo.close().finally(() => { process.exitCode = 1; });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    demo.close().catch(logError).finally(() => process.exit());
  });
}
