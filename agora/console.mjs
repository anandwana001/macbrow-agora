import { once } from 'node:events';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDemo } from './server.mjs';
import { NativeAudio } from './native-audio.mjs';
import { Transcripts } from './transcripts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function apiRequest(base, path, body, signal) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(90000)]),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || `Local API returned ${response.status}`);
  return result;
}

export async function startVoice(api, audio, { signal, listenOnly = false } = {}) {
  const { data: config } = await apiRequest(api, '/get_config', undefined, signal);
  // Join before starting the cloud agent, so the greeting is not lost.
  await audio.join(config, { listenOnly });
  signal?.throwIfAborted();
  const { data } = await apiRequest(api, '/startAgent', {
    channelName: config.channel_name, rtcUid: Number(config.agent_uid), userUid: Number(config.uid),
  }, signal);
  return { config, agentId: data.agent_id };
}

export async function runConsole({ smoke = false } = {}) {
  for (const file of ['.env.agora', '.env.local']) {
    try { process.loadEnvFile(resolve(ROOT, file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const demo = createDemo({
    appId: process.env.AGORA_APP_ID, appCertificate: process.env.AGORA_APP_CERTIFICATE,
    endpoint: process.env.MACBROW_MCP_URL, dataChannel: 'datastream',
    onAction: (result) => console.log(`jev> ${result.executed ? 'executed' : result.awaiting_confirmation ? 'awaiting confirmation' : 'handled'} ${Object.entries(result.timings ?? {}).map(([key, ms]) => `${key}=${Math.round(ms)}ms`).join(' ')}`),
  });
  const abort = new AbortController();
  let finish;
  const done = new Promise((resolveDone) => { finish = resolveDone; });
  let audio, poll, smokeTimer, config, receivedAudio = false;
  const stop = () => { abort.abort(); finish(); void audio?.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    demo.control.listen(8000, '127.0.0.1');
    demo.mcp.listen(8101, '127.0.0.1');
    await Promise.all([once(demo.control, 'listening'), once(demo.mcp, 'listening')]);
    console.log('macbrow + Agora — terminal voice console');
    console.log('Keep your HTTPS tunnel to port 8101 running. Ctrl-C to end the conversation.');
    audio = new NativeAudio(ROOT);
    const transcripts = new Transcripts();
    audio.on('failure', (error) => { finish(error); abort.abort(error); });
    audio.on('message', (message) => {
      if (message.event === 'permission') console.log(message.message);
      if (message.event === 'agent-joined') console.log('Agora agent joined.');
      if (message.event === 'agent-audio') { receivedAudio = true; console.log('Agora audio connected.'); }
      if (message.event === 'agent-left') finish();
      if (message.event === 'transcript-data') transcripts.accept(message.text);
      if (message.event === 'renew-token' && config) {
        apiRequest('http://127.0.0.1:8000', `/get_config?channel=${encodeURIComponent(config.channel_name)}&uid=${config.uid}`, undefined, abort.signal)
          .then(({ data }) => audio.send({ command: 'renew', token: data.token }))
          .catch((error) => { finish(error); abort.abort(error); });
      }
    });
    const session = await startVoice('http://127.0.0.1:8000', audio, { signal: abort.signal, listenOnly: smoke });
    config = session.config;
    console.log(smoke ? 'Smoke check: microphone and playback disabled; waiting for agent audio.' : 'Listening. Speak a command, or say “stop listening” to finish.');
    // A spoken stop or the backend's session limit also closes the native client.
    let polling = false;
    poll = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const health = await apiRequest('http://127.0.0.1:8000', '/health', undefined, abort.signal);
        if (!health.active) finish();
      } catch (error) { if (!abort.signal.aborted) finish(error); }
      finally { polling = false; }
    }, 2000);
    if (smoke) smokeTimer = setTimeout(() => finish(receivedAudio ? undefined : new Error('No agent audio received during smoke check.')), 15000);
    const error = await done;
    if (error) throw error;
    if (smoke && !receivedAudio) throw new Error('Agent ended before native audio was verified.');
  } catch (error) {
    if (!abort.signal.aborted || abort.signal.reason instanceof Error && abort.signal.reason.name !== 'AbortError') throw error;
  } finally {
    clearInterval(poll);
    clearTimeout(smokeTimer);
    abort.abort();
    // Revoke tools immediately, while the audio process leaves RTC.
    const [cloudClose] = await Promise.allSettled([demo.close(), audio?.close()]);
    if (cloudClose.status === 'rejected') {
      // Access is revoked even if Agora's stop endpoint is temporarily unavailable.
      console.error('Cloud stop could not be confirmed. Local Mac access has been revoked.');
      process.exitCode = 1;
    }
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    console.log('Voice console stopped.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runConsole({ smoke: process.argv.includes('--smoke') }).catch((error) => {
    console.error(`Console failed: ${error.message}`);
    process.exitCode = 1;
  });
}
