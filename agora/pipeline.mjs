// Adapted from the official Next.js quickstart, db055babff9499a332a97dbcdacc75c95bc7c0ef.
// See SOURCES.md and AGORA-LICENSE for provenance.
import { Agent, DeepgramSTT, OpenAI, MiniMaxTTS } from 'agora-agents';

export const INSTRUCTIONS = `You are macbrow, a concise voice assistant controlling this Mac.
Agora provides your speech recognition, language model and speech synthesis.
Use run_mac_command for every request to act on or inspect the Mac. Pass the user's
actual words unchanged, not an inferred shell command or rewritten instruction.
Use a new turn_id for each user turn; reuse that ID only when retrying the same tool call.
When the tool asks for confirmation or clarification, read its speak text verbatim.
Send the user's next answer (including yes/no) through run_mac_command; never confirm
your own request. Do not substitute your own confirmation workflow for the tool's.
Only report success when the tool says an action executed or reports a verified result.
If the tool times out, do not retry automatically or claim that nothing happened.
If handoff_to_llm is true, answer the user yourself without claiming a Mac action.
Answer ordinary conversation directly in one short sentence. Do not use markdown.
The default demo supports predefined app, URL, tab and volume commands. Autonomous
website tasks and learning new actions are optional and may be unavailable.
If stop is true, say the tool's goodbye; the session will end automatically.`;

export function buildAgent(client, endpoint, secret, { dataChannel = 'rtm' } = {}) {
  const greeting = 'macbrow ready, powered by Agora. Try asking me to open Chrome.';
  return new Agent({
    client, instructions: INSTRUCTIONS, greeting,
    failureMessage: 'I could not complete that request. Please try again.',
    maxHistory: 50,
    turnDetection: { config: {
      speech_threshold: 0.5,
      start_of_speech: { mode: 'vad', vad_config: { interrupt_duration_ms: 160, prefix_padding_ms: 300 } },
      end_of_speech: { mode: 'vad', vad_config: { silence_duration_ms: 480 } },
    } },
    advancedFeatures: { enable_rtm: true, enable_tools: true },
    parameters: { audio_scenario: 'chorus', data_channel: dataChannel, enable_error_message: true, enable_metrics: true },
  })
    .withStt(new DeepgramSTT({ model: 'nova-3', language: 'en' }))
    .withLlm(new OpenAI({
      model: 'gpt-4o-mini', greetingMessage: greeting, maxHistory: 15,
      params: { max_tokens: 1024, temperature: 0.7, top_p: 0.95 },
      mcpServers: [{
        name: 'macbrow', endpoint, transport: 'streamable_http',
        headers: { Authorization: `Bearer ${secret}` },
        // Agora validates MCP timeouts in the range 1,000–100,000 ms.
        allowed_tools: ['run_mac_command'], timeout_ms: 100000,
      }],
    }))
    .withTts(new MiniMaxTTS({ model: 'speech_2_6_turbo', voiceId: 'English_captivating_female1' }));
}
