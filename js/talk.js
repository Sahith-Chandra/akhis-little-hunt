// “Talk to Sahith”: a live voice chat with an ElevenLabs agent that speaks in Sahith's cloned voice.
// Opt-in only. The SDK (1.1 MB) loads the first time she taps “Start talking”.
// Config: hunt.json → talk.agentId (public by design; lock it down with the agent's domain allowlist).
import { icons } from './icons.js';
import { audio } from './media.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.29.0/dist/lib.iife.js';
let sdkPromise = null;
let session = null;
let root = null;
let starting = false;
const DEBUG = new URLSearchParams(location.search).has('test');
let lastError = '';

export const talkEnabled = (cfg) => Boolean(cfg.talk && cfg.talk.agentId);

function loadSdk() {
  if (window.ElevenLabsClient) return Promise.resolve(window.ElevenLabsClient);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK; s.async = true;
      s.onload = () => (window.ElevenLabsClient ? resolve(window.ElevenLabsClient) : reject(new Error('sdk')));
      s.onerror = () => { sdkPromise = null; reject(new Error('sdk')); };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

export function talkHTML(cfg, esc) {
  const name = esc(cfg.talk.name || 'Sahith');
  // Only the title is visible text. The circle is the on/off button; its color shows the state.
  return `
    <div class="sheet-head"><h2 class="sheet-title">Talk to ${name}</h2>
      <button class="icon-btn soft" data-act="close" aria-label="Close">${icons.close(20)}</button></div>
    <button class="talk-orb" id="talk-orb" data-state="idle" data-act="talk-toggle" aria-label="Start talking to ${name}"><span></span>${icons.mic(40)}</button>
    <p class="sr-only" id="talk-status" role="status" aria-live="polite"></p>
    ${DEBUG ? '<p class="talk-debug" id="talk-debug"></p>' : ''}`;
}

const LABEL = { idle: 'Start talking', connecting: 'Connecting, tap to cancel', listening: 'Listening, tap to end', speaking: 'Talking, tap to end' };

function setUI(state, text) {
  if (!root) return;
  const orb = root.querySelector('#talk-orb');
  const st = root.querySelector('#talk-status');
  const dbg = root.querySelector('#talk-debug');
  if (orb) { orb.dataset.state = state; orb.setAttribute('aria-label', LABEL[state] || LABEL.idle); }
  if (st && text) st.textContent = text;
  if (dbg) dbg.textContent = state === 'idle' && text && /^(Call ended|Error|Couldn|Microphone|No signal)/.test(text) ? text : '';
}

function addLine() { /* transcript intentionally not shown */ }

export async function toggleTalk(el, cfg) {
  root = el;
  if (session || starting) return endTalk();
  if (!navigator.onLine) return setUI('idle', 'No signal right now. Try again when you’re connected.');
  starting = true;
  audio.stop();
  setUI('connecting', 'Connecting…');
  try {
    const { Conversation } = await loadSdk();
    session = await Conversation.startSession({
      agentId: cfg.talk.agentId,
      // WebSocket, not WebRTC: the agent's domain allowlist rejects WebRTC calls from the site ("Access denied. Your domain is not authorized").
      connectionType: 'websocket',
      onConnect: () => setUI('listening', 'Listening… go ahead.'),
      onDisconnect: (d) => {
        session = null;
        let why = '';
        if (d && d.reason === 'error') why = d.message || (d.context && d.context.reason) || d.closeReason || 'error';
        else if (d && d.reason === 'agent') why = `agent ended it${d.closeReason ? `: ${d.closeReason}` : ''}${d.closeCode ? ` (${d.closeCode})` : ''}`;
        if (lastError && !why) why = lastError;
        setUI('idle', DEBUG && why ? `Call ended: ${why}` : 'Conversation ended. Tap to talk again.');
        lastError = '';
      },
      onModeChange: ({ mode }) => setUI(mode === 'speaking' ? 'speaking' : 'listening', mode === 'speaking' ? `${cfg.talk.name || 'Sahith'} is talking…` : 'Listening…'),
      onMessage: (m) => {
        const text = m && (m.message || m.text);
        const who = m && (m.source === 'user' || m.role === 'user') ? 'you' : 'him';
        addLine(who, text);
      },
      onError: (msg, ctx) => {
        lastError = String(msg || (ctx && (ctx.message || ctx.reason)) || 'error');
        setUI('idle', DEBUG ? `Error: ${lastError}` : 'Something went wrong. Tap to try again.');
      },
    });
  } catch (err) {
    session = null;
    const denied = err && (err.name === 'NotAllowedError' || /permission|denied/i.test(String(err.message || err)));
    setUI('idle', denied ? 'Microphone is off. Allow it in Settings › Safari › Microphone, then try again.' : 'Couldn’t connect. Check your signal and try again.');
  } finally {
    starting = false;
  }
}

export async function endTalk() {
  const s = session;
  session = null;
  if (s) { try { await s.endSession(); } catch {} }
  setUI('idle', 'Conversation ended. Tap to talk again.');
}

export function detachTalk() { endTalk(); root = null; }
