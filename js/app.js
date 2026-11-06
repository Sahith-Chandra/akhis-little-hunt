// Akhi’s Little Hunt — app controller.
import { icons, paw } from './icons.js';
import { audio, photos, characters, slotHTML } from './media.js';
import { createMap, distanceM, zoneFor, offsetM, ILLUSTRATION, DEFAULT_CENTER } from './map.js';
import { renderOrganizer } from './organizer.js';
import { talkEnabled, talkHTML, toggleTalk, endTalk, detachTalk } from './talk.js';

/* ------------------------------------------------------------------ state */
const params = new URLSearchParams(location.search);
export const TEST = params.has('test');
const KEYS = {
  progress: TEST ? 'akhi-hunt-progress-test' : 'akhi-hunt-progress',
  overrides: 'akhi-hunt-overrides',
  prefs: 'akhi-hunt-prefs',
  fake: 'akhi-hunt-fakegps',
};
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const freshProgress = () => ({ started: false, introSeen: false, done: {}, hints: {}, arrived: {}, finishedAt: null });

let base = null;           // hunt.json as shipped
export let cfg = null;     // hunt.json + organizer overrides
let progress = { ...freshProgress(), ...store.get(KEYS.progress, {}) };
const prefs = { calm: matchMedia('(prefers-reduced-motion: reduce)').matches, captions: true, ...store.get(KEYS.prefs, {}) };
const geo = { pos: null, acc: null, status: 'idle', watchId: null, fake: TEST && store.get(KEYS.fake, false) };
let mapCtl = null;
let overlay = null;        // { name, opts }
let pendingArrived = false;
let lastD = null, lastTrendAt = 0, lastStopId = null;
let photoStop = null;

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
photos.prefix = TEST ? 'test:' : '';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const saveProgress = () => store.set(KEYS.progress, progress);
const savePrefs = () => store.set(KEYS.prefs, prefs);

export function buildConfig() {
  const o = store.get(KEYS.overrides, {});
  const c = JSON.parse(JSON.stringify(base));
  for (const s of c.stops) {
    const p = o.pins && o.pins[s.id];
    if (p) { if (p.lat != null) s.lat = p.lat; if (p.lng != null) s.lng = p.lng; if (p.radiusM) s.radiusM = p.radiusM; }
  }
  if (o.letter) c.letter = { ...c.letter, ...o.letter };
  for (const k of ['lunchMode', 'lunchPlace', 'gatheringMode']) if (o[k] != null) c[k] = o[k];
  cfg = c;
  return c;
}
export const getOverrides = () => store.get(KEYS.overrides, {});
export function setOverrides(o) { store.set(KEYS.overrides, o); buildConfig(); }
export const getBase = () => base;

/* --------------------------------------------------------------- stop data */
const numbered = () => cfg.stops.filter((s) => s.number);
const fill = (t) => String(t).replaceAll('{place}', cfg.lunchPlace || 'the pizza place');

/** A stop with the organizer’s alternatives (pizza lunch, home gathering) applied. */
export function view(stop) {
  if (!stop) return null;
  const s = { ...stop, variant: '' };
  if (s.id === 'lunch' && cfg.lunchMode === 'pizza' && s.lunchAlternative?.pizza) {
    const a = s.lunchAlternative.pizza;
    Object.assign(s, { clue: fill(a.clue), hints: a.hints.map(fill), variant: 'pizza' });
  }
  if (s.id === 'badminton' && cfg.gatheringMode === 'home' && s.homeBackup) {
    Object.assign(s, { title: s.homeBackup.title, clue: s.homeBackup.clue, hints: s.homeBackup.hints, variant: 'home', lat: null, lng: null, home: true });
  }
  if (TEST && !s.home && !s.intermission && (s.lat == null || s.lng == null)) {
    // Practice mode: invent a pin so the zone/warmer flow can be tried anywhere.
    const p = offsetM({ lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] }, (s.number || 1) * 47, 180 + (s.number || 1) * 60);
    Object.assign(s, { lat: p.lat, lng: p.lng, fakePin: true });
  }
  return s;
}
export const voiceKey = (s, kind, i) => (kind === 'sfx' ? `stop.${s.id}.sfx` : `stop.${s.id}${s.variant ? '.' + s.variant : ''}.${kind}.${i}`);
const hasPin = (s) => s && s.lat != null && s.lng != null && !s.home;
const current = () => cfg.stops.find((s) => !progress.done[s.id]) || null;
const cur = () => view(current());
const doneCount = () => numbered().filter((s) => progress.done[s.id]).length;
const stopById = (id) => view(cfg.stops.find((s) => s.id === id));

/* ------------------------------------------------------------------ toast */
let toastT = 0;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  try {
    const res = await fetch('hunt.json', { cache: 'no-cache' });
    base = await res.json();
  } catch {
    app.innerHTML = `<div class="loading"><p>Couldn’t load the hunt. Check your connection and reopen.</p></div>`;
    return;
  }
  readSetupLink();
  buildConfig();
  applyPrefs();
  await Promise.all([audio.init(), characters.load()]);
  characters.setReducedMotion(prefs.calm);
  registerSW();
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', onVisibility);
  audio.onChange((state) => {
    const root = $('#ov');
    characters.cue(root, state === 'start' ? 'speak-start' : 'speak-stop');
    document.querySelectorAll('.speak-btn, [data-act="speak"]').forEach((b) => {
      const on = state === 'start' && audio.current && b.dataset.key === audio.current.key;
      b.classList.toggle('playing', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });
  route();
}

function applyPrefs() {
  document.documentElement.classList.toggle('calm', !!prefs.calm);
  characters.setReducedMotion(!!prefs.calm);
}

function readSetupLink() {
  const m = location.hash.match(/^#setup=(.+)$/);
  if (!m) return;
  try {
    const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
    const incoming = JSON.parse(json);
    if (confirm('Apply the organizer setup from this link? (pins, letter, lunch and gathering settings)')) {
      store.set(KEYS.overrides, { ...store.get(KEYS.overrides, {}), ...incoming });
      toast('Setup applied');
    }
  } catch { toast('That setup link didn’t work'); }
  history.replaceState(null, '', location.pathname + location.search);
}

function route() {
  if (location.hash === '#organizer') return showOrganizer();
  if (!progress.introSeen) return showIntro();
  if (!progress.started) return showWelcome();
  showMap();
}

/* ----------------------------------------------------------- front screens */
function front(html, cls = '') {
  let f = $('#front');
  if (!f) { f = document.createElement('div'); f.id = 'front'; f.className = 'screen'; f.style.zIndex = 30; app.appendChild(f); }
  characters.destroyIn(f);
  f.className = 'screen full ' + cls;
  f.innerHTML = html;
  f.hidden = false;
  characters.mountIn(f);
  return f;
}
function hideFront() { const f = $('#front'); if (f) { characters.destroyIn(f); f.hidden = true; f.innerHTML = ''; } }

function showIntro() {
  $('#loading')?.remove();
  const i = cfg.intro;
  const f = front(`
    <div class="intro">
      <div class="row" style="justify-content:flex-end"><button class="btn btn-night" style="min-height:44px;border-radius:22px" data-act="skip-intro">Skip ${icons.chevron(16)}</button></div>
      <div class="video-box">
        <video id="intro-video" playsinline preload="metadata" ${audio.muted ? 'muted' : ''} poster="${esc(i.poster)}">
          <source src="${esc(i.video)}" type="video/mp4">
          <track kind="captions" src="${esc(i.captions)}" srclang="en" label="English" ${prefs.captions ? 'default' : ''}>
        </video>
        <div class="video-ph" id="video-ph" hidden>${icons.film(44)}<b style="font:600 14px var(--display);letter-spacing:1px;text-transform:uppercase">Video coming soon</b><span style="font-weight:700;font-size:14px;line-height:1.5;max-width:230px">Dora and Boots have a birthday message for you. Read it below for now.</span></div>
      </div>
      <div style="text-align:center;display:flex;flex-direction:column;gap:4px">
        <p style="font:600 14px var(--display);letter-spacing:1.5px;text-transform:uppercase;color:#B9C3E6">A birthday message</p>
        <h1 style="font:700 36px/1.05 var(--display)">For ${esc(cfg.birthday.fullName)}, <span style="color:var(--amber)">at ${cfg.birthday.age}!</span></h1>
      </div>
      <button class="btn btn-amber btn-lg" id="play-intro" data-act="play-intro">${icons.play(20)} Play birthday message</button>
      <div class="grid2">
        <button class="btn btn-night" data-act="captions" aria-pressed="${prefs.captions}">${prefs.captions ? 'Captions on' : 'Captions off'}</button>
        <button class="btn btn-night" data-act="transcript">Read it instead</button>
      </div>
    </div>`, 'intro-wrap');
  f.style.background = 'var(--navy)';
  const v = $('#intro-video', f);
  const showPh = () => { $('#video-ph', f).hidden = false; v.hidden = true; const b = $('#play-intro', f); b.innerHTML = `${icons.play(20)} Read the message`; b.dataset.act = 'transcript'; };
  fetch(i.video, { method: 'HEAD' }).then((r) => { if (!r.ok) showPh(); }).catch(showPh);
  v.addEventListener('error', showPh, true);
  v.addEventListener('ended', () => { progress.introSeen = true; saveProgress(); if (document.fullscreenElement) document.exitFullscreen?.(); route(); });
  v.addEventListener('play', () => { audio.stop(); const b = $('#play-intro', f); if (b) b.innerHTML = `${icons.stop(18)} Pause`; });
  v.addEventListener('pause', () => { const b = $('#play-intro', f); if (b && b.dataset.act === 'play-intro') b.innerHTML = `${icons.play(20)} Keep watching`; });
  v.addEventListener('loadedmetadata', () => setCaptions(v));
}
function setCaptions(v) { if (v && v.textTracks[0]) v.textTracks[0].mode = prefs.captions ? 'showing' : 'hidden'; }

function showWelcome() {
  $('#loading')?.remove();
  const w = cfg.welcome;
  front(`
    <div class="map-fallback" aria-hidden="true">${ILLUSTRATION}</div>
    <div class="welcome-fade"></div>
    <div class="welcome" style="position:relative">
      <span class="chip chip-green">Nov 9 · Level ${cfg.birthday.age} unlocked</span>
      <h1>${esc(cfg.birthday.name)}’s<br><span>Little Hunt</span></h1>
      <p class="lede">${['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten'][numbered().length] || numbered().length} envelopes. Your favorite places. One spotted guide.</p>
      <div style="margin:18px 0 10px">${slotHTML(w.companionCharacter, w.animationCue || 'enter', { size: 'lg' })}</div>
      <div class="card">
        <div class="note"><span class="ic">${icons.pin(20)}</span><p>The map uses your location only while this app is open. Nothing is saved or sent anywhere.</p></div>
        <button class="btn btn-amber btn-lg" data-act="start">Start my adventure ${icons.chevron(20)}</button>
        <button class="btn btn-ghost" data-act="intro">${icons.play(16)} Watch my birthday message again</button>
      </div>
    </div>`);
}

function showOrganizer() {
  $('#loading')?.remove();
  const f = front('<div class="org" id="org"></div>');
  renderOrganizer($('#org', f), {
    cfg, base, progress, TEST, esc,
    getOverrides, setOverrides,
    stops: () => cfg.stops,
    setProgress(p) { progress = p; saveProgress(); },
    freshProgress,
    resetPhotos: () => photos.clear(cfg.stops.map((s) => s.id)),
    toast,
    close() { history.replaceState(null, '', location.pathname + location.search); route(); },
  });
}

/* --------------------------------------------------------------- map screen */
function showMap() {
  $('#loading')?.remove();
  hideFront();
  let scr = $('#scr-map');
  if (!scr) {
    scr = document.createElement('div');
    scr.id = 'scr-map'; scr.className = 'screen';
    scr.innerHTML = `<div class="map-wrap" id="mapwrap"></div>
      <div class="map-night" id="night" hidden></div>
      <div class="hud" id="hud">
        <div class="topbar">
          <button class="paw-chip" data-act="trail" id="paw-chip"><span class="dot">${paw(20)}</span><span id="paw-count"></span></button>
          ${TEST ? '<button class="practice-chip" data-act="practice">Practice</button>' : ''}
          <span class="spacer"></span>
          <button class="icon-btn" data-act="mute" id="mute-btn"></button>
          ${talkEnabled(cfg) ? `<button class="icon-btn" data-act="talk" aria-label="Talk to ${esc(cfg.talk.name || 'Sahith')}">${icons.mic(22)}</button>` : ''}
          <button class="icon-btn" data-act="settings" aria-label="Settings">${icons.gear(22)}</button>
        </div>
        <button class="heat-pill" id="heat" data-act="heat" aria-live="polite"></button>
        <div class="bubble-wrap hide" id="bubble">${slotHTML('leopard', 'idle', { size: 'sm' })}<div class="bubble" id="bubble-text" role="status"></div></div>
        <button class="icon-btn recenter" id="recenter" data-act="recenter" aria-label="Back to me" hidden>${icons.crosshair(22)}</button>
        <nav class="bottomnav" aria-label="Hunt">
          <button class="nav-side" data-act="trail"><span class="icon-btn">${icons.trail(24)}</span>Trail</button>
          <button class="nav-clue" data-act="clue" id="clue-btn"><span class="big"><small>Clue</small><b id="clue-n"></b></span></button>
          <button class="nav-side" data-act="album"><span class="icon-btn">${icons.camera(24)}</span>Photos</button>
        </nav>
      </div>
      <div class="overlay" id="ov" hidden></div>`;
    app.appendChild(scr);
    characters.mountIn($('#hud'));
    mapCtl = createMap($('#mapwrap'), {
      onUserMove: () => { $('#recenter').hidden = false; },
      onTap: (p) => { if (TEST && geo.fake) onPosition(p, 5); },
    });
    if (geo.fake && TEST) { geo.status = 'on'; }
    startGeo();
  }
  refresh();
}

/** Re-sync HUD, zone and the forced overlays with progress. */
function refresh() {
  if (!$('#scr-map')) return;
  const s = cur();
  $('#paw-count').textContent = `${doneCount()}/${numbered().length}`;
  $('#paw-chip').setAttribute('aria-label', `Trail: ${doneCount()} of ${numbered().length} envelopes found`);
  const m = $('#mute-btn');
  m.innerHTML = audio.muted ? icons.muted(22) : icons.sound(22);
  m.setAttribute('aria-label', audio.muted ? 'Sound off. Turn sound on' : 'Sound on. Mute');
  $('#clue-n').textContent = s ? (s.number || '') : '♥';
  $('#clue-btn').setAttribute('aria-label', s ? `Open clue for envelope ${s.number}` : 'Open your letter');
  $('#night').hidden = !(s && s.intermission);
  if (lastStopId !== (s && s.id)) { lastD = null; lastStopId = s && s.id; }
  if (mapCtl) {
    mapCtl.setZone(s && hasPin(s) ? { ...zoneFor(s), n: s.number, label: `Envelope ${s.number} is somewhere in here` } : null);
  }
  renderHeat();
  if (s && s.intermission && (!overlay || overlay.name !== 'classbreak')) openOverlay('classbreak');
  if (!s && (!overlay || overlay.name !== 'finale') && !progress.finaleClosed) openOverlay('finale');
}

/* ---------------------------------------------------------------- location */
function startGeo() {
  if (!progress.started || geo.watchId != null) return;
  if (geo.fake) { if (!geo.pos) fakeAt('far'); return; }
  if (!('geolocation' in navigator)) { geo.status = 'unavailable'; renderHeat(); return; }
  geo.status = geo.status === 'on' ? 'on' : 'waiting';
  renderHeat();
  geo.watchId = navigator.geolocation.watchPosition(
    (p) => { if (geo.fake) return; geo.status = 'on'; onPosition({ lat: p.coords.latitude, lng: p.coords.longitude }, p.coords.accuracy); },
    (err) => { geo.status = err.code === 1 ? 'denied' : 'unavailable'; renderHeat(); },
    { enableHighAccuracy: true, maximumAge: 4000, timeout: 30000 },
  );
}
function stopGeo() { if (geo.watchId != null) { navigator.geolocation.clearWatch(geo.watchId); geo.watchId = null; } }

function onPosition(p, acc) {
  geo.pos = p; geo.acc = acc;
  if (geo.fake) geo.status = 'on';
  mapCtl && mapCtl.setPlayer(p);
  evaluate();
}

function heatOf(s) {
  if (!s || !hasPin(s) || !geo.pos) return null;
  const d = distanceM(geo.pos, s);
  const r = (s.radiusM || 40) + Math.min(geo.acc || 0, 25);
  const level = d <= r ? 'here' : d <= r + 70 ? 'hot' : d <= 300 ? 'warm' : d <= 800 ? 'warmish' : 'cold';
  return { d, level };
}

function evaluate() {
  const s = cur();
  const h = heatOf(s);
  renderHeat();
  if (!h || s.intermission) return;
  const now = Date.now();
  if (lastD == null) lastD = h.d;
  else if (Math.abs(h.d - lastD) > 30 && h.level !== 'here') {
    const warmer = h.d < lastD; lastD = h.d;
    if (now - lastTrendAt > 25000 && !overlay) {
      lastTrendAt = now;
      say(warmer ? cfg.reactions.warmer : cfg.reactions.colder);
      if (warmer) characters.cue($('#hud'), 'warmer');
      audio.sfx(warmer ? 'reaction.warmer' : 'reaction.colder');
    }
  }
  if (h.level === 'here' && !progress.arrived[s.id]) {
    progress.arrived[s.id] = now; saveProgress();
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    if (!overlay) openOverlay('arrived'); else pendingArrived = true;
    audio.play('reaction.here');
  }
}

const fmtDist = (m) => { const ft = m * 3.281; return ft < 1000 ? `${Math.max(10, Math.round(ft / 10) * 10)} ft` : `${(m / 1609.34).toFixed(m < 16000 ? 1 : 0)} mi`; };
const HEAT_LABEL = { here: 'On fire! You’re right here', hot: 'Hot!', warm: 'Warmer!', warmish: 'Getting warmer', cold: 'Cold' };

function renderHeat() {
  const el = $('#heat');
  if (!el) return;
  const s = cur();
  el.hidden = !s || s.intermission;
  if (el.hidden) return;
  let cls = 'h-off', ic = icons.pin(18), strong = '', rest = '';
  const h = heatOf(s);
  if (!hasPin(s)) { strong = 'Mystery spot'; rest = s.home ? 'follow your clue home' : 'follow your clue'; }
  else if (geo.status === 'denied') { strong = 'Location is off'; rest = 'clues still work'; }
  else if (geo.status === 'unavailable') { strong = 'Can’t find you'; rest = 'clues still work'; }
  else if (!h) { strong = 'Finding you…'; rest = ''; }
  else {
    cls = h.level === 'here' ? 'h-here' : h.level === 'hot' ? 'h-hot' : h.level === 'cold' ? 'h-cold' : 'h-warm';
    ic = h.level === 'cold' ? icons.snow(18) : icons.flame(18);
    strong = HEAT_LABEL[h.level];
    rest = h.level === 'here' ? '' : `about ${fmtDist(h.d)}`;
    if (geo.acc > 60 && h.level !== 'here') rest += ' · GPS is fuzzy';
  }
  el.className = `heat-pill ${cls}`;
  el.innerHTML = `<span class="flame">${ic}</span><strong>${esc(strong)}</strong>${rest ? `<span>${esc(rest)}</span>` : ''}`;
}

let bubbleT = 0;
function say(text, ms = 6500) {
  const b = $('#bubble');
  if (!b) return;
  $('#bubble-text').textContent = text;
  b.classList.remove('hide');
  clearTimeout(bubbleT); bubbleT = setTimeout(() => b.classList.add('hide'), ms);
}

function fakeAt(where) {
  const s = cur();
  const target = hasPin(s) ? { lat: s.lat, lng: s.lng } : { lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] };
  const dist = { far: 650, near: 160, here: 4 }[where] ?? 650;
  onPosition(offsetM(target, 200, dist), 8);
  mapCtl && mapCtl.recenter();
}

/* ---------------------------------------------------------------- overlays */
const sheet = (inner, cls = '') => `<div class="scrim" data-act="scrim"></div><section class="sheet ${cls}" role="dialog" aria-modal="true"><span class="grabber" aria-hidden="true"></span>${inner}</section>`;
const closeBtn = () => `<button class="icon-btn soft" data-act="close" aria-label="Close">${icons.close(20)}</button>`;
const elChip = (s) => (s.element ? `<span class="chip el-${s.element}">${s.element[0].toUpperCase() + s.element.slice(1)}</span>` : '');
const speakBtn = (key, label) => (audio.has(key) ? `<button class="speak-btn" data-act="speak" data-key="${key}" aria-pressed="false"><span class="ic">${icons.play(14)}</span>${esc(label)}</button>` : '');
function pawRow(highlightId) {
  return `<div class="paw-row" aria-label="${doneCount()} of ${numbered().length} paw prints">${numbered().map((s) => `<span class="${progress.done[s.id] ? 'on' : ''} ${s.id === highlightId ? 'new' : ''}">${paw(16)}</span>`).join('')}</div>`;
}

function foundBox(s) {
  if (s.unlock === 'code') {
    return `<form class="found-box" data-form="code" data-stop="${s.id}" novalidate>
      <h3>Found it?</h3>
      <p class="sheet-sub">${esc(s.codePrompt || 'Type the code word you found.')}</p>
      <input class="code-input" name="code" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" aria-label="Code word" placeholder="Code word">
      <p class="err" id="code-err" hidden></p>
      <button class="btn btn-green btn-block" type="submit">Unlock</button>
    </form>`;
  }
  return `<div class="found-box"><h3>Found it?</h3><p class="sheet-sub">Tap when it’s in your hands.</p><button class="btn btn-green btn-block" data-act="manual" data-stop="${s.id}">${esc(s.manualLabel || 'I found it!')}</button></div>`;
}

const OV = {
  clue({ id } = {}) {
    const s = id ? stopById(id) : cur();
    if (!s) return OV.finale();
    const done = progress.done[s.id];
    return sheet(`
      <div class="sheet-head"><div class="row"><span class="chip chip-amber">Envelope ${s.number}</span>${elChip(s)}</div>${closeBtn()}</div>
      <div class="row" style="align-items:center;gap:14px">${slotHTML(s.companionCharacter, 'enter', { size: 'md' })}<h2 class="sheet-title">${esc(s.title)}</h2></div>
      <p class="quote">“${esc(s.clue)}”</p>
      ${speakBtn(voiceKey(s, 'voice', 0), 'Hear it from the leopard')}
      ${done
        ? `<div class="found-card"><div class="thumb" data-photo="${s.id}">${icons.check(26)}</div><div><small>You found</small><b>${esc(s.foundLabel)}</b></div></div>`
        : `<div class="grid2"><button class="btn btn-outline" data-act="hints">Need a hint?</button><button class="btn btn-green" data-act="found">I found it!</button></div>`}`);
  },

  hints() {
    const s = cur();
    const n = progress.hints[s.id] || 0;
    const nextLabels = ['Give me a nudge', 'Show me a landmark', 'Just tell me'];
    return sheet(`
      <div class="sheet-head"><h2 class="sheet-title">Hints · envelope ${s.number}</h2>${closeBtn()}</div>
      <div class="row" style="align-items:center;gap:12px">${slotHTML('fluttershy', 'hint', { size: 'sm' })}<p class="sheet-sub" style="flex:1">Take as many as you need. No penalty, ever.</p></div>
      ${s.hints.slice(0, n).map((h, i) => `<div class="hint"><span class="n">${i + 1}</span><p>${esc(h)}</p>${audio.has(voiceKey(s, 'hint', i)) ? `<button class="icon-btn" data-act="speak" data-key="${voiceKey(s, 'hint', i)}" aria-label="Hear hint ${i + 1}">${icons.play(14)}</button>` : ''}</div>`).join('')}
      ${n < s.hints.length ? `<button class="btn btn-dashed btn-block" data-act="more-hint">${icons.bulb(18)} ${nextLabels[n] || 'Another hint'}</button>` : ''}
      ${foundBox(s)}`, 'tall');
  },

  found() {
    const s = cur();
    return sheet(`
      <div class="sheet-head"><div class="row"><span class="chip chip-amber">Envelope ${s.number}</span></div>${closeBtn()}</div>
      <div class="row" style="align-items:center;gap:14px">${slotHTML(s.companionCharacter, 'idle', { size: 'sm' })}<h2 class="sheet-title" style="font-size:24px">${esc(s.title)}</h2></div>
      ${foundBox(s)}
      <button class="btn btn-ghost" data-act="hints">${icons.bulb(16)} I need a hint</button>`);
  },

  arrived() {
    const s = cur();
    return `<div class="scrim" data-act="scrim"></div><div class="center-wrap"><div class="popup" role="dialog" aria-modal="true" aria-labelledby="arr-h">
      ${slotHTML(s.companionCharacter, 'success', { size: 'md' })}
      <span class="chip chip-amber">Envelope ${s.number}</span>
      <h2 id="arr-h" style="font:700 32px/1.05 var(--display)">You made it!</h2>
      <p style="font-weight:700;color:var(--soft);line-height:1.45">${esc(cfg.reactions.here)} Look around closely.</p>
      <div class="grid2" style="width:100%"><button class="btn btn-outline" data-act="clue">See clue</button><button class="btn btn-green" data-act="found">I found it!</button></div>
    </div></div>`;
  },

  unlock({ id }) {
    const s = stopById(id);
    const next = cur();
    const nextLabel = !next ? 'Open my letter' : next.intermission ? 'Off to class' : `On to envelope ${next.number}`;
    return `<div class="full" role="dialog" aria-modal="true" aria-labelledby="unl-h"><div class="unlock-screen">
      <div class="rays" aria-hidden="true"></div>
      <span class="chip chip-green">Envelope ${s.number} unlocked</span>
      <div class="big-ring">${slotHTML(s.completeCharacter || s.companionCharacter, 'success', { size: 'lg' })}</div>
      <h1 class="hooray" id="unl-h">Paw-some!</h1>
      <div class="found-card"><div class="thumb" data-photo="${s.id}">${icons.camera(26)}</div><div><small>You found</small><b>${esc(s.foundLabel)}</b></div></div>
      ${pawRow(s.id)}
      <div style="flex:1"></div>
      <button class="btn btn-amber btn-lg btn-block" data-act="continue">${nextLabel} ${icons.chevron(20)}</button>
      <button class="btn btn-outline btn-block" data-act="photo" data-stop="${s.id}">${icons.camera(18)} <span data-photo-label="${s.id}">Snap a photo first</span></button>
      <p class="sheet-sub">${esc(s.photoPrompt || '')}</p>
    </div></div>`;
  },

  trail() {
    const list = numbered();
    const now = current();
    return sheet(`
      <div class="sheet-head"><div><h2 class="sheet-title">Your trail</h2><p class="sheet-sub">${doneCount()} of ${list.length} paw prints</p></div>${closeBtn()}</div>
      <div class="progress" aria-hidden="true"><i style="width:${(doneCount() / list.length) * 100}%"></i></div>
      ${now && now.intermission ? `<p class="sheet-sub">Class break: the trail picks back up after class.</p>` : ''}
      <div class="trail-grid">${list.map((s) => {
        if (progress.done[s.id]) return `<button class="tile done" data-act="recap" data-stop="${s.id}"><span class="num">${s.number}</span>${esc(s.title)}${icons.check(18)}</button>`;
        if (now && now.id === s.id) return `<button class="tile now" data-act="clue"><span class="num">${s.number}</span>Open now</button>`;
        return `<button class="tile sealed" data-act="sealed" aria-label="Envelope ${s.number}, sealed"><span class="num">${s.number}</span>${icons.lock(18)}Sealed</button>`;
      }).join('')}</div>`, 'tall');
  },

  album() {
    const list = numbered().filter((s) => progress.done[s.id] || (current() && current().id === s.id));
    return sheet(`
      <div class="sheet-head"><div><h2 class="sheet-title">Photo album</h2><p class="sheet-sub" id="album-count">Saved only on this phone</p></div>${closeBtn()}</div>
      <div class="album">${list.map((s) => `<figure class="polaroid">
          <button class="snap" data-act="photo" data-stop="${s.id}" data-photo-tile="${s.id}">${icons.camera(26)}Snap it</button>
          <figcaption>${s.number} · ${esc(s.photoPrompt)}</figcaption></figure>`).join('')}</div>
      <div style="flex:1"></div>
      <div class="grid2"><button class="btn btn-green" data-act="export">Save our story</button><button class="btn btn-outline" data-act="print">Print / PDF</button></div>`, 'tall');
  },

  classbreak() {
    const s = cur();
    return `<div class="full" role="dialog" aria-modal="true" aria-labelledby="cb-h"><div class="night-screen">
      <svg class="stars" viewBox="0 0 390 300" preserveAspectRatio="xMidYMin slice" aria-hidden="true"><g fill="#FFF3C4"><circle cx="60" cy="70" r="2.5"/><circle cx="130" cy="40" r="2"/><circle cx="300" cy="60" r="2.5"/><circle cx="340" cy="130" r="2"/><circle cx="40" cy="160" r="2"/><circle cx="230" cy="100" r="1.8"/></g><path d="M318 40a26 26 0 1 0 26 34 20 20 0 1 1-26-34z" fill="#FFE39A"/></svg>
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px;position:relative">
        <span class="chip chip-night">Intermission · 12–2</span>
        <h1 id="cb-h">${esc(s.clue.split('.')[0])}.</h1>
        <p>The map is snoozing. ${esc(s.resumeNote || '')}</p>
        ${slotHTML(s.companionCharacter, 'idle', { size: 'xl', label: 'Sleeping leopard + Aang', extra: 'night' })}
        ${audio.has(voiceKey(s, 'voice', 0)) ? `<button class="btn btn-night" style="border-radius:25px" data-act="speak" data-key="${voiceKey(s, 'voice', 0)}">${icons.play(16)} “${esc(s.voiceLines[0])}”</button>` : `<p style="font-style:italic">“${esc(s.voiceLines[0])}”</p>`}
      </div>
      <div style="width:100%;display:flex;flex-direction:column;align-items:center;gap:10px;position:relative">
        <button class="btn btn-amber btn-lg btn-block" data-act="resume">${esc(s.resumeLabel || 'I’m out of class')}!</button>
        <p>Someone might be waiting outside…</p>
      </div>
    </div></div>`;
  },

  finale() {
    const L = cfg.letter;
    const paras = String(L.body || '').split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join('');
    const finished = !current();
    return `<div class="full" role="dialog" aria-modal="true" aria-labelledby="fin-h" style="background:var(--peach)"><div class="finale">
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
        <span class="chip chip-green">${doneCount()} of ${numbered().length} · Hunt complete!</span>
        ${pawRow()}
        ${slotHTML('group', 'success', { size: 'wide', label: 'Group portrait: leopard + friends' })}
      </div>
      <article class="letter">
        <h1 id="fin-h">${esc(L.heading || 'For you')}</h1>
        <div class="body">${paras}</div>
        <p class="sign">${esc(L.signoff || '')}</p>
        ${audio.has('letter') ? `<button class="btn btn-outline" data-act="speak" data-key="letter">${icons.mic(18)} Play my voice note</button>` : ''}
      </article>
      <section style="display:flex;flex-direction:column;gap:10px"><h2 style="font:700 20px var(--display)">Today, in pictures</h2>
        <div class="pics">${numbered().map((s) => `<div data-photo-bg="${s.id}" role="img" aria-label="${esc(s.photoPrompt)}"></div>`).join('')}</div></section>
      ${finished && cfg.friday?.revealAfterFinale !== false ? `<section class="friday"><small>Bonus level · Friday</small><p>${esc(cfg.friday.teaser)}</p></section>` : ''}
      <button class="btn btn-green btn-lg" data-act="export">Save our birthday story</button>
      ${talkEnabled(cfg) ? `<button class="btn btn-outline" data-act="talk">${icons.mic(18)} Talk to ${esc(cfg.talk.name || 'Sahith')}</button>` : ''}
      <button class="btn btn-ghost" data-act="finale-close">${icons.trail(16)} Back to the map</button>
    </div></div>`;
  },

  talk() { return sheet(talkHTML(cfg, esc), 'talk-sheet'); },

  settings() {
    const sw = (on) => `<span class="switch" aria-hidden="true"></span>`;
    const loc = { on: 'On while the app is open', waiting: 'Waiting for permission', denied: 'Off: allow it in Settings › Safari › Location', unavailable: 'Unavailable right now', idle: 'Starts with the adventure' }[geo.status];
    return sheet(`
      <div class="sheet-head"><h2 class="sheet-title">Settings</h2>${closeBtn()}</div>
      <div class="list">
        <button class="list-row" role="switch" aria-checked="${!audio.muted}" data-act="toggle-sound"><span class="grow">Sound<small>Voices and little sound effects</small></span>${sw()}</button>
        <button class="list-row" role="switch" aria-checked="${!!prefs.calm}" data-act="toggle-calm"><span class="grow">Calm animations<small>Still poses, no bouncing</small></span>${sw()}</button>
        <button class="list-row" role="switch" aria-checked="${!!prefs.captions}" data-act="toggle-captions"><span class="grow">Captions<small>For the birthday message</small></span>${sw()}</button>
        <button class="list-row" data-act="intro"><span class="grow">Watch my birthday message</span>${icons.chevron(18)}</button>
        <button class="list-row" data-act="album"><span class="grow">Photo album</span>${icons.chevron(18)}</button>
        ${talkEnabled(cfg) ? `<button class="list-row" data-act="talk"><span class="grow">Talk to ${esc(cfg.talk.name || 'Sahith')}</span>${icons.chevron(18)}</button>` : ''}
        <div class="list-row"><span class="grow">Location<small>${esc(loc)}. Never saved or sent.</small></span></div>
        <div class="list-row"><span class="grow">Offline<small id="offline-status">Checking…</small></span></div>
      </div>
      <p class="sheet-sub" style="text-align:center">Made with love for ${esc(cfg.birthday.name)}${TEST ? ' · practice mode' : ''}</p>`);
  },

  transcript() {
    return sheet(`
      <div class="sheet-head"><h2 class="sheet-title">${esc(cfg.intro.heading)}</h2>${closeBtn()}</div>
      <div class="transcript">${cfg.intro.transcript.map((t) => `<p><b>${esc(t.speaker)}:</b> ${esc(t.line)}</p>`).join('')}</div>
      ${!progress.introSeen ? `<button class="btn btn-amber btn-lg" data-act="skip-intro">Let’s go! ${icons.chevron(20)}</button>` : ''}`, 'tall');
  },

  location() {
    return sheet(`
      <div class="sheet-head"><h2 class="sheet-title">About location</h2>${closeBtn()}</div>
      <p style="font-weight:700;line-height:1.5;color:var(--soft)">The map follows you only while this app is open, so it can tell you when you’re getting warmer. Your location never leaves this phone and isn’t saved.</p>
      ${geo.status === 'denied' ? `<p style="font-weight:700;line-height:1.5">To turn it on: Settings › Privacy & Security › Location Services › Safari Websites › <b>While Using</b>. Then come back and reload.</p>` : ''}
      <p class="sheet-sub">No location? No problem. Every envelope can still be found with the clue, hints and code.</p>
      <button class="btn btn-green" data-act="close">Got it</button>`);
  },

  practice() {
    const s = cur();
    return sheet(`
      <div class="sheet-head"><h2 class="sheet-title">Practice mode</h2>${closeBtn()}</div>
      <p class="sheet-sub">Separate progress and photos from the real hunt. ${s && s.fakePin ? 'This stop has no real pin yet, so a pretend one is used.' : ''}</p>
      <div class="list practice-panel">
        <button class="list-row" role="switch" aria-checked="${geo.fake}" data-act="toggle-fake"><span class="grow">Pretend GPS<small>Tap anywhere on the map to move there</small></span><span class="switch" aria-hidden="true"></span></button>
      </div>
      <div class="row practice-panel"><button class="btn btn-soft" data-act="fake" data-where="far">Far</button><button class="btn btn-soft" data-act="fake" data-where="near">Near</button><button class="btn btn-soft" data-act="fake" data-where="here">Here</button></div>
      <div class="grid2"><button class="btn btn-outline" data-act="skip-stop">Skip this stop</button><button class="btn btn-outline" data-act="reset-practice">Reset practice</button></div>
      <a class="btn btn-ghost" href="${location.pathname}?test=1#organizer">Open organizer</a>`);
  },
};

function openOverlay(name, opts = {}) {
  const ov = $('#ov');
  if (!ov) return;
  if (overlay && overlay.name === 'talk') detachTalk();
  characters.destroyIn(ov);
  audio.stop();
  overlay = { name, opts };
  ov.innerHTML = OV[name](opts);
  $('#scr-map')?.classList.toggle('ov-full', ['classbreak', 'unlock', 'finale'].includes(name));
  ov.hidden = false;
  characters.mountIn(ov);
  hydratePhotos(ov);
  if (name === 'settings') offlineStatus();
  const focusEl = ov.querySelector('.code-input') && name === 'found' ? ov.querySelector('.code-input') : ov.querySelector('[data-act="close"], .btn');
  try { focusEl && focusEl.focus({ preventScroll: true }); } catch {}
}
function closeOverlay() {
  const ov = $('#ov');
  if (!ov || !overlay) return;
  if (overlay.name === 'classbreak') return; // only “I’m out of class” closes it
  if (overlay.name === 'talk') detachTalk();
  audio.stop();
  characters.destroyIn(ov);
  ov.hidden = true; ov.innerHTML = ''; overlay = null; $('#scr-map')?.classList.remove('ov-full');
  if (pendingArrived) { pendingArrived = false; const s = cur(); if (s && progress.arrived[s.id] && !progress.done[s.id]) return openOverlay('arrived'); }
  refresh();
}
function rerender() { if (overlay) { const st = $('#ov .sheet')?.scrollTop; openOverlay(overlay.name, overlay.opts); const sh = $('#ov .sheet'); if (sh && st) sh.scrollTop = st; } }

async function hydratePhotos(root) {
  for (const el of root.querySelectorAll('[data-photo]')) {
    const u = await photos.url(el.dataset.photo);
    if (u) { el.style.backgroundImage = `url("${u}")`; el.innerHTML = ''; const l = root.querySelector(`[data-photo-label="${el.dataset.photo}"]`); if (l) l.textContent = 'Retake photo'; }
  }
  for (const el of root.querySelectorAll('[data-photo-bg]')) {
    const u = await photos.url(el.dataset.photoBg);
    if (u) el.style.backgroundImage = `url("${u}")`;
  }
  let n = 0;
  for (const el of root.querySelectorAll('[data-photo-tile]')) {
    const u = await photos.url(el.dataset.photoTile);
    if (u) { n++; el.outerHTML = `<button class="ph" data-act="photo" data-stop="${el.dataset.photoTile}" style="background-image:url('${u}')" aria-label="Replace this photo"></button>`; }
  }
  const c = root.querySelector('#album-count');
  if (c) c.textContent = n ? `${n} moment${n === 1 ? '' : 's'} saved on this phone` : 'Saved only on this phone';
}

async function offlineStatus() {
  const el = $('#offline-status');
  if (!el) return;
  try {
    const name = (await caches.keys()).filter((k) => k.startsWith('akhi-shell-')).sort().pop();
    const keys = name ? await (await caches.open(name)).keys() : [];
    const chars = keys.filter((r) => r.url.includes('/characters/art/')).length;
    el.textContent = keys.length ? `Ready: works without signal (${keys.length} files, ${chars} character art files). The map needs signal for new areas.` : 'Not ready yet. Open once on Wi-Fi.';
  } catch { el.textContent = 'Not available in this browser'; }
}

/* ----------------------------------------------------------------- actions */
function unlock(s) {
  progress.done[s.id] = Date.now();
  if (!current()) progress.finishedAt = Date.now();
  saveProgress();
  lastD = null;
  if (navigator.vibrate) navigator.vibrate(80);
  openOverlay('unlock', { id: s.id }); // the last unlock leads to the letter via “Open my letter”
  characters.cue($('#ov'), 'success');
  (async () => {
    await audio.play(voiceKey(s, 'sfx'));
    if (overlay && (overlay.name === 'unlock' || overlay.name === 'finale') && !audio.current) audio.play('reaction.unlock');
  })();
  refreshQuiet();
}
function refreshQuiet() { if ($('#paw-count')) $('#paw-count').textContent = `${doneCount()}/${numbered().length}`; }

const normalize = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const actions = {
  'skip-intro'() { progress.introSeen = true; saveProgress(); $('#intro-video')?.pause(); closeOverlay(); route(); },
  'play-intro'() {
    const v = $('#intro-video');
    if (!v) return;
    if (v.paused) { v.muted = audio.muted; setCaptions(v); v.play().catch(() => toast('Couldn’t play the video')); } else v.pause();
  },
  captions(b) {
    prefs.captions = !prefs.captions; savePrefs();
    setCaptions($('#intro-video'));
    b.textContent = prefs.captions ? 'Captions on' : 'Captions off';
    b.setAttribute('aria-pressed', prefs.captions);
  },
  transcript() {
    if (!$('#scr-map') || !$('#front')?.hidden) {
      // On the intro screen: show the transcript in place.
      const f = $('#front');
      const box = document.createElement('div'); box.className = 'overlay'; box.id = 'intro-ov';
      box.innerHTML = OV.transcript().replace('data-act="scrim"', 'data-act="close-intro-ov"').replace(/data-act="close"/g, 'data-act="close-intro-ov"');
      f.appendChild(box);
      return;
    }
    openOverlay('transcript');
  },
  'close-intro-ov'() { $('#intro-ov')?.remove(); },
  intro() { closeOverlayForce(); showIntro(); },
  start() {
    progress.started = true; saveProgress();
    showMap();
    const line = cfg.welcome.voiceLines[0];
    setTimeout(() => { say(line, 9000); audio.play('welcome.voice.0'); }, 600);
  },
  close() { closeOverlay(); },
  scrim() { closeOverlay(); },
  clue() { openOverlay('clue'); },
  recap(b) { openOverlay('clue', { id: b.dataset.stop }); },
  sealed() { toast('Sealed until you get there'); },
  hints() { openOverlay('hints'); },
  found() { openOverlay('found'); setTimeout(() => $('#ov .code-input')?.focus(), 30); },
  'more-hint'() {
    const s = cur();
    progress.hints[s.id] = Math.min((progress.hints[s.id] || 0) + 1, s.hints.length); saveProgress();
    rerender();
    characters.cue($('#ov'), 'hint');
    const k = voiceKey(s, 'hint', progress.hints[s.id] - 1);
    audio.play(k);
    const sh = $('#ov .sheet'); const hs = sh && sh.querySelectorAll('.hint'); if (hs && hs.length) hs[hs.length - 1].scrollIntoView({ block: 'nearest', behavior: prefs.calm ? 'auto' : 'smooth' });
  },
  manual(b) { const s = stopById(b.dataset.stop); if (s && !progress.done[s.id]) unlock(s); },
  continue() {
    overlay = null; $('#ov').hidden = true; $('#ov').innerHTML = ''; $('#scr-map').classList.remove('ov-full');
    refresh();
    const s = cur();
    if (s && !s.intermission) { openOverlay('clue'); audio.play(voiceKey(s, 'voice', 0)); }
  },
  resume() {
    const s = cur();
    progress.done[s.id] = Date.now(); saveProgress();
    overlay = null; $('#ov').hidden = true; $('#ov').innerHTML = ''; $('#scr-map').classList.remove('ov-full');
    refresh();
    const n = cur();
    if (n) { openOverlay('clue'); audio.play(voiceKey(n, 'voice', 0)); }
  },
  trail() { openOverlay('trail'); },
  album() { openOverlay('album'); },
  settings() { openOverlay('settings'); },
  talk() { if (overlay && overlay.name === 'finale') { progress.finaleClosed = true; saveProgress(); } openOverlay('talk'); },
  'talk-toggle'() { toggleTalk($('#ov .sheet'), cfg); },
  practice() { openOverlay('practice'); },
  heat() { openOverlay(geo.status === 'denied' || geo.status === 'unavailable' ? 'location' : 'clue'); },
  recenter() { mapCtl && mapCtl.recenter(); $('#recenter').hidden = true; },
  mute() { audio.setMuted(!audio.muted); refresh(); toast(audio.muted ? 'Sound off' : 'Sound on'); },
  'toggle-sound'(b) { audio.setMuted(!audio.muted); b.setAttribute('aria-checked', !audio.muted); refresh(); },
  'toggle-calm'(b) { prefs.calm = !prefs.calm; savePrefs(); applyPrefs(); b.setAttribute('aria-checked', prefs.calm); },
  'toggle-captions'(b) { prefs.captions = !prefs.captions; savePrefs(); b.setAttribute('aria-checked', prefs.captions); },
  'toggle-fake'(b) {
    geo.fake = !geo.fake; store.set(KEYS.fake, geo.fake); b.setAttribute('aria-checked', geo.fake);
    if (geo.fake) { stopGeo(); fakeAt('far'); } else { geo.pos = null; mapCtl?.setPlayer(null); startGeo(); }
    toast(geo.fake ? 'Pretend GPS on: tap the map to move' : 'Using real GPS');
  },
  fake(b) { if (!geo.fake) { geo.fake = true; store.set(KEYS.fake, true); stopGeo(); } closeOverlay(); fakeAt(b.dataset.where); },
  'skip-stop'() { const s = cur(); if (!s) return; closeOverlayForce(); if (s.intermission) { progress.done[s.id] = Date.now(); saveProgress(); refresh(); } else unlock(s); },
  'reset-practice'() {
    if (!confirm('Reset practice progress and practice photos?')) return;
    progress = freshProgress(); progress.introSeen = true; progress.started = true; saveProgress();
    photos.clear(cfg.stops.map((s) => s.id));
    closeOverlayForce(); refresh(); toast('Practice reset');
  },
  'finale-close'() { progress.finaleClosed = true; saveProgress(); closeOverlayForce(); refresh(); },
  speak(b) {
    const k = b.dataset.key;
    if (audio.current && audio.current.key === k) { audio.stop(); return; }
    if (audio.muted) { toast('Sound is off. Turn it on in settings'); return; }
    audio.play(k);
  },
  photo(b) {
    photoStop = b.dataset.stop;
    const input = $('#photo-input');
    input.value = '';
    input.click();
  },
  export() { exportStory(); },
  print() { printAlbum(); },
};
function closeOverlayForce() { const ov = $('#ov'); if (!ov) return; if (overlay && overlay.name === 'talk') detachTalk(); audio.stop(); characters.destroyIn(ov); ov.hidden = true; ov.innerHTML = ''; overlay = null; $('#scr-map')?.classList.remove('ov-full'); }

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a || a.disabled) return;
  const fn = actions[a.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(a, e);
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form="code"]');
  if (!f) return;
  e.preventDefault();
  const s = stopById(f.dataset.stop);
  const input = f.querySelector('.code-input');
  if (normalize(input.value) === normalize(s.code)) { input.blur(); unlock(s); return; }
  const err = f.querySelector('#code-err');
  input.classList.remove('wrong'); void input.offsetWidth; input.classList.add('wrong');
  err.hidden = false; err.textContent = cfg.reactions.wrongCode;
  characters.cue($('#ov'), 'error');
  audio.play('reaction.wrongCode').then((ok) => { if (!ok) audio.play('sfx.wrong'); });
  if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(); });

$('#photo-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file || !photoStop) return;
  try {
    await photos.save(photoStop, file);
    toast('Saved to your album');
    characters.cue($('#ov'), 'success');
    audio.sfx('sfx.purr');
    if (overlay) rerender();
  } catch { toast('Couldn’t save that photo. Try again?'); }
  photoStop = null;
});

function onVisibility() {
  if (document.hidden) { audio.stop(); endTalk(); characters.pauseAll(); stopGeo(); $('#intro-video')?.pause(); }
  else if (progress.started && $('#scr-map')) startGeo();
}

/* --------------------------------------------------------- story & print */
async function storyHTML() {
  const items = [];
  for (const s of numbered()) {
    if (!progress.done[s.id]) continue;
    items.push({ s, img: await photos.dataUrl(s.id) });
  }
  const L = cfg.letter;
  const finished = !current();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(cfg.title)}: our story</title>
<style>body{margin:0;background:#FFE9BF;color:#2A2D3E;font-family:-apple-system,system-ui,sans-serif}main{max-width:640px;margin:0 auto;padding:32px 18px 60px}h1{font-size:34px;margin:0 0 4px}.sub{color:#5B5E70;font-weight:700;margin:0 0 24px}figure{margin:0 0 20px;background:#fff;border-radius:20px;padding:10px 10px 14px;box-shadow:0 4px 0 rgba(42,45,62,.08)}figure img{width:100%;border-radius:14px;display:block}figcaption{padding:10px 6px 0;font-weight:700;line-height:1.4}figcaption b{display:block;font-size:18px}.letter{background:#FFFDF7;border-radius:22px;padding:22px;margin-top:24px;font-family:Georgia,serif;font-size:18px;line-height:1.6;white-space:pre-wrap}</style></head>
<body><main><h1>${esc(cfg.title)}</h1><p class="sub">${esc(cfg.birthday.fullName)} · ${cfg.birthday.age} · November 9, 2026</p>
${items.map(({ s, img }) => `<figure>${img ? `<img src="${img}" alt="${esc(s.photoPrompt)}">` : ''}<figcaption><b>${s.number}. ${esc(s.title)}</b>${esc(s.foundLabel)}</figcaption></figure>`).join('')}
${finished ? `<div class="letter"><b>${esc(L.heading)}</b>\n\n${esc(L.body)}\n\n<i>${esc(L.signoff)}</i></div>` : ''}
</main></body></html>`;
}
async function exportStory() {
  toast('Making your story…');
  const html = await storyHTML();
  const name = 'akhis-little-hunt-story.html';
  const file = new File([html], name, { type: 'text/html' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: cfg.title }); return; }
  } catch (err) { if (err && err.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  toast('Story saved');
}
async function printAlbum() {
  const root = $('#print-root');
  const parts = [];
  for (const s of numbered()) {
    const u = await photos.url(s.id);
    if (u) parts.push(`<figure class="pp"><img src="${u}" alt=""><figcaption>${s.number}. ${esc(s.title)}: ${esc(s.foundLabel)}</figcaption></figure>`);
  }
  root.innerHTML = `<h1>${esc(cfg.title)}</h1>${parts.join('') || '<p>No photos yet.</p>'}`;
  setTimeout(() => window.print(), 300);
}

/* ---------------------------------------------------------- service worker */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // Skip on localhost while developing (add ?sw=1 to test offline locally).
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !params.has('sw')) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch(() => {});
  // A new version took over: reload once so the new code runs (progress and photos are kept).
  // Wait if she's mid-conversation or picking a photo; it then applies on the next open.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    if (overlay && (overlay.name === 'talk' || overlay.name === 'unlock')) return;
    if (photoStop) return;
    reloaded = true;
    location.reload();
  });
}

boot();
