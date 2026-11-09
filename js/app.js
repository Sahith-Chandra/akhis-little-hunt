// Akhi’s Little Hunt — app controller.
import { icons, paw } from './icons.js';
import { audio, photos, characters, slotHTML } from './media.js';
import { createMap, distanceM, zoneFor, offsetM, ILLUSTRATION, DEFAULT_CENTER } from './map.js';
import { renderOrganizer } from './organizer.js';
import { talkEnabled, talkHTML, toggleTalk, endTalk, detachTalk } from './talk.js';
import { letterDeliveryHTML, mountLetterDelivery } from '../characters/letter-delivery/index.js';
import { unsealLetter } from './letter-lock.js';

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
const freshProgress = () => ({ started: false, introSeen: false, done: {}, hints: {}, arrived: {}, finishedAt: null, letterOpened: null });

let base = null;           // hunt.json as shipped
export let cfg = null;     // hunt.json + organizer overrides
let progress = { ...freshProgress(), ...store.get(KEYS.progress, {}) };
const prefs = { calm: matchMedia('(prefers-reduced-motion: reduce)').matches, captions: true, ...store.get(KEYS.prefs, {}) };
const geo = { pos: null, acc: null, status: 'idle', watchId: null, fake: TEST && store.get(KEYS.fake, false) };
let mapCtl = null;
let letterDelivery = null;
const clearLetterDelivery = () => { letterDelivery?.destroy(); letterDelivery = null; };
let overlay = null;        // { name, opts }
let advanceLockUntil = 0;  // a double tap must never land on the next stop's button
let arrival = { id: null, inside: false };
let arrivePulseT = 0;
let photoStop = null, afterPhoto = null;

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
photos.prefix = TEST ? 'test:' : '';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const saveProgress = () => store.set(KEYS.progress, progress);
const ADVANCE_LOCK_MS = 1200;
const GLOW_HIDE_M = 305; // within 1000 ft only the hot/cold pill remains
const EXIT_MARGIN_M = 20;
const NO_LOCATION = 'Follow your paper clue—location is optional.';
const ARRIVED_TEXT = 'You’re in the right area!';
const reducedMotion = () => Boolean(prefs.calm) || matchMedia('(prefers-reduced-motion: reduce)').matches;
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
const photoStops = () => cfg.stops.filter((s) => s.photoPrompt);
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
  settleOldProgress();
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

/** Progress saved before a pause was added: don't send her back to a pause she has already passed. */
function settleOldProgress() {
  const later = (i) => cfg.stops.slice(i + 1).some((s) => progress.done[s.id]);
  cfg.stops.forEach((s, i) => { if (s.intermission && !progress.done[s.id] && later(i)) progress.done[s.id] = Date.now(); });
  saveProgress();
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
        <a class="mode-link" href="${location.pathname}${TEST ? '' : '?test=1'}">${TEST ? 'Real hunt' : 'Playground'}</a>
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
  $('#clue-n').textContent = s ? (s.number || '♥') : '♥';
  $('#clue-btn').setAttribute('aria-label', s ? (s.number ? `Open clue for envelope ${s.number}` : 'Open clue') : 'Open your letter');
  $('#night').hidden = !(s && s.intermission);
  if (mapCtl) {
    mapCtl.setZone(s && hasPin(s) ? zoneFor(s) : null);
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
    (p) => { if (geo.fake) return; geo.status = 'on'; onPosition({ lat: p.coords.latitude, lng: p.coords.longitude, speed: p.coords.speed, heading: p.coords.heading, accuracy: p.coords.accuracy, timestamp: p.timestamp }, p.coords.accuracy); },
    (err) => { geo.status = err.code === 1 ? 'denied' : 'unavailable'; renderHeat(); },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 },
  );
}
function stopGeo() { if (geo.watchId != null) { navigator.geolocation.clearWatch(geo.watchId); geo.watchId = null; } }

function onPosition(p, acc) {
  geo.pos = p; geo.acc = acc;
  if (geo.fake) geo.status = 'on';
  mapCtl && mapCtl.setPlayer(p);
  evaluate();
}

const arrivalRadius = (s) => (s.radiusM || 40) + Math.min(geo.acc || 0, 25);
const locationMissing = (s) => !hasPin(s) || geo.status === 'denied' || geo.status === 'unavailable';

function heatOf(s) {
  if (!s || !hasPin(s) || !geo.pos) return null;
  const d = distanceM(geo.pos, s);
  const r = arrivalRadius(s);
  const here = arrival.id === s.id && arrival.inside;
  const level = here ? 'here' : d <= r + 70 ? 'hot' : d <= 300 ? 'warm' : d <= 800 ? 'warmish' : 'cold';
  return { d, level };
}

function locStatusHTML(s) {
  if (!s || s.intermission) return '';
  if (arrival.id === s.id && arrival.inside) return `<span class="ic">${icons.check(16)}</span>${esc(ARRIVED_TEXT)}`;
  return locationMissing(s) ? esc(NO_LOCATION) : '';
}

/** Tracks whether she is inside the current stop's arrival area. Purely visual: it never completes a stop. */
function syncArrival() {
  const s = cur();
  const id = s && !s.intermission ? s.id : null;
  if (arrival.id !== id) arrival = { id, inside: false };
  let inside = false;
  if (id && hasPin(s) && geo.pos && geo.status === 'on') {
    const r = arrivalRadius(s);
    inside = distanceM(geo.pos, s) <= (arrival.inside ? r + EXIT_MARGIN_M : r);
  }
  const entered = inside && !arrival.inside;
  arrival.inside = inside;
  const scr = $('#scr-map');
  if (scr) {
    scr.classList.toggle('is-arrived', inside);
    if (!inside) scr.classList.remove('arrive-pulse');
  }
  mapCtl && mapCtl.setArrived(inside);
  const line = $('#loc-status');
  if (line) {
    const html = locStatusHTML(s);
    if (line.dataset.html !== html) { line.dataset.html = html; line.innerHTML = html; line.className = locStatusClass(s); }
  }
  const btn = $('#complete-btn');
  if (btn && s && !s.intermission) btn.hidden = !canComplete(s);
  if (entered) onArrive(s);
}
const locStatusClass = (s) => `loc-status${arrival.inside && arrival.id === s?.id ? ' arrived' : ''}`;

function onArrive(s) {
  const scr = $('#scr-map');
  if (scr && !reducedMotion()) {
    scr.classList.remove('arrive-pulse'); void scr.offsetWidth; scr.classList.add('arrive-pulse');
    clearTimeout(arrivePulseT); arrivePulseT = setTimeout(() => scr.classList.remove('arrive-pulse'), 1500);
  }
  if (progress.arrived[s.id]) return; // the character reacts once per stop
  progress.arrived[s.id] = Date.now(); saveProgress();
  if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
  if (overlay) characters.cue($('#ov'), 'success');
  audio.sfx('reaction.here');
}

function evaluate() { renderHeat(); }

const fmtDist = (m) => { const ft = m * 3.281; return ft < 1000 ? `${Math.max(10, Math.round(ft / 10) * 10)} ft` : `${(m / 1609.34).toFixed(m < 16000 ? 1 : 0)} mi`; };
const HEAT_LABEL = { here: ARRIVED_TEXT, hot: 'Hot!', warm: 'Warmer!', warmish: 'Getting warmer', cold: 'Cold' };

function renderHeat() {
  syncArrival();
  const near = cur();
  mapCtl && mapCtl.setGlow(!(near && hasPin(near) && geo.pos && distanceM(geo.pos, near) <= GLOW_HIDE_M));
  const el = $('#heat');
  if (!el) return;
  const s = cur();
  el.hidden = !s || s.intermission;
  if (el.hidden) return;
  let cls = 'h-off', ic = icons.pin(18), strong = '', rest = '';
  const h = heatOf(s);
  if (locationMissing(s)) { cls = 'h-off h-note'; strong = NO_LOCATION; }
  else if (!h) { strong = 'Finding you…'; rest = ''; }
  else {
    cls = h.level === 'here' ? 'h-arrived' : h.level === 'hot' ? 'h-hot' : h.level === 'cold' ? 'h-cold' : 'h-warm';
    ic = h.level === 'here' ? icons.check(18) : h.level === 'cold' ? icons.snow(18) : icons.flame(18);
    strong = HEAT_LABEL[h.level];
    rest = h.level === 'here' ? '' : `about ${fmtDist(h.d)}`;
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

const isFinalStop = (s) => numbered().at(-1).id === s.id;
/** The found-it button needs her at the spot. Where location can't tell (no pin, GPS off), it stays available. */
const canComplete = (s) => TEST || locationMissing(s) || (arrival.id === s.id && arrival.inside);
function completeBtn(s) {
  const label = isFinalStop(s) ? 'I found it—finish our adventure.' : 'I found it—let’s go to the next one.';
  return `<button class="btn btn-green btn-lg btn-block" id="complete-btn" data-act="complete" data-stop="${s.id}" ${canComplete(s) ? '' : 'hidden'}>${esc(label)}</button>`;
}
const locStatus = (s) => `<p id="loc-status" class="${locStatusClass(s)}" role="status" data-html="${esc(locStatusHTML(s))}">${locStatusHTML(s)}</p>`;

const collageBox = (withImage) => `<section class="collage" data-collage hidden>
  ${withImage ? '<img alt="A collage of your photos from today">' : ''}
  <button class="save-collage" data-act="save-collage" aria-label="Save collage to camera roll">${icons.download(28)}</button>
</section>`;

/** A locked letter needs its code once on each phone; after that it is kept on that phone. */
const letterReady = () => Boolean(progress.letterOpened) && (!cfg.letter.sealed || getOverrides().letter?.unlockedFor === cfg.letter.sealed.iv);
let showEnvelope = false; // leaving the letter returns to the envelope so Hedwig can deliver it again
const letterShown = () => letterReady() && !showEnvelope;

function askLetterCode() {
  const host = $('#ov .full');
  if (!host) return;
  const box = document.createElement('div');
  box.className = 'code-pop';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'code-h');
  box.innerHTML = `<form class="code-card" novalidate>
    <button type="button" class="icon-btn soft code-x" aria-label="Close">${icons.close(20)}</button>
    <h2 id="code-h">Enter the code to read your letter</h2>
    <input class="code-input" type="text" inputmode="numeric" autocomplete="off" maxlength="4" aria-label="4 digit code" placeholder="• • • •">
    <p class="code-msg" role="status"></p>
    <button type="button" class="btn btn-outline btn-block code-hint-btn">Hint</button>
    <p class="code-hint" hidden>(anniversary month + day) = 4 digit pin</p>
    <button type="submit" class="btn btn-amber btn-lg btn-block">Open my letter</button>
  </form>`;
  host.appendChild(box);
  const input = box.querySelector('.code-input'), msg = box.querySelector('.code-msg'), submit = box.querySelector('[type=submit]');
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); msg.textContent = ''; });
  box.querySelector('.code-x').addEventListener('click', () => { box.remove(); rerender(); });
  box.querySelector('.code-hint-btn').addEventListener('click', (e) => { box.querySelector('.code-hint').hidden = false; e.currentTarget.hidden = true; });
  box.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (input.value.length !== 4) { msg.textContent = 'The code has 4 digits.'; return; }
    submit.disabled = true;
    msg.textContent = 'Checking…';
    let letter = null;
    try { letter = await unsealLetter(cfg.letter.sealed, input.value); } catch { msg.textContent = 'That didn’t work on this phone. Try again?'; submit.disabled = false; return; }
    if (!letter) { msg.textContent = 'That’s not it. Try again?'; input.value = ''; submit.disabled = false; return; }
    setOverrides({ ...getOverrides(), letter: { ...letter, unlockedFor: cfg.letter.sealed.iv } });
    progress.letterOpened = Date.now(); saveProgress();
    box.remove();
    rerender();
  });
  try { input.focus({ preventScroll: true }); } catch {}
}

const OV = {
  clue({ id } = {}) {
    const s = id ? stopById(id) : cur();
    if (!s) return OV.finale();
    const done = progress.done[s.id];
    return sheet(`
      <div class="sheet-head"><div class="row"><span class="chip chip-amber">${esc(s.chip || `Envelope ${s.number}`)}</span>${elChip(s)}</div>${closeBtn()}</div>
      <div class="row" style="align-items:center;gap:14px">${slotHTML(s.companionCharacter, 'enter', { size: 'md' })}<h2 class="sheet-title">${esc(s.title)}</h2></div>
      <p class="quote">“${esc(s.clue)}”</p>
      ${speakBtn(voiceKey(s, 'voice', 0), 'Hear this clue')}
      ${done ? '' : locStatus(s)}
      ${done
        ? `<div class="found-card"><div class="thumb" data-photo="${s.id}">${icons.check(26)}</div><div><small>You found</small><b>${esc(s.foundLabel)}</b></div></div>`
        : `${completeBtn(s)}<button class="btn btn-outline btn-block" data-act="hints">Need a hint?</button>`}`, done ? '' : 'clue-sheet');
  },

  hints() {
    const s = cur();
    const n = progress.hints[s.id] || 0;
    const nextLabels = ['Give me a nudge', 'Show me a landmark', 'Just tell me'];
    return sheet(`
      <div class="sheet-head"><h2 class="sheet-title">${s.number ? `Hints · envelope ${s.number}` : 'Hints'}</h2>${closeBtn()}</div>
      <div class="row" style="align-items:center;gap:12px">${slotHTML('fluttershy', 'hint', { size: 'sm' })}<p class="sheet-sub" style="flex:1">Take as many as you need. No penalty, ever.</p></div>
      ${s.hints.slice(0, n).map((h, i) => `<div class="hint"><span class="n">${i + 1}</span><p>${esc(h)}</p>${audio.has(voiceKey(s, 'hint', i)) ? `<button class="icon-btn" data-act="speak" data-key="${voiceKey(s, 'hint', i)}" aria-label="Hear hint ${i + 1}">${icons.play(14)}</button>` : ''}</div>`).join('')}
      ${n < s.hints.length ? `<button class="btn btn-dashed btn-block" data-act="more-hint">${icons.bulb(18)} ${nextLabels[n] || 'Another hint'}</button>` : ''}
      ${locStatus(s)}
      ${completeBtn(s)}`, 'tall clue-sheet');
  },

  trail() {
    const list = numbered();
    const now = current();
    return sheet(`
      <div class="sheet-head"><div><h2 class="sheet-title">Your trail</h2><p class="sheet-sub">${doneCount()} of ${list.length} paw prints</p></div>${closeBtn()}</div>
      <div class="progress" aria-hidden="true"><i style="width:${(doneCount() / list.length) * 100}%"></i></div>
      ${now && now.intermission ? `<p class="sheet-sub">${esc(now.title)}: the trail picks back up afterward.</p>` : ''}
      <div class="trail-grid">${list.map((s) => {
        if (progress.done[s.id]) return `<button class="tile done" data-act="recap" data-stop="${s.id}"><span class="num">${s.number}</span>${esc(s.title)}${icons.check(18)}</button>`;
        if (now && now.id === s.id) return `<button class="tile now" data-act="clue"><span class="num">${s.number}</span>Open now</button>`;
        return `<button class="tile sealed" data-act="sealed" aria-label="Envelope ${s.number}, sealed"><span class="num">${s.number}</span>${icons.lock(18)}Sealed</button>`;
      }).join('')}</div>`, 'tall');
  },

  album() {
    const list = photoStops().filter((s) => progress.done[s.id] || (current() && current().id === s.id));
    return sheet(`
      <div class="sheet-head"><div><h2 class="sheet-title">Photo album</h2><p class="sheet-sub" id="album-count">Saved only on this phone</p></div>${closeBtn()}</div>
      <div class="album">${list.map((s) => `<figure class="polaroid">
          <button class="snap" data-act="photo" data-stop="${s.id}" data-photo-tile="${s.id}">${icons.camera(26)}Snap it</button>
          <figcaption>${s.number ? `${s.number} · ` : ''}${esc(s.photoPrompt)}</figcaption></figure>`).join('')}</div>
      <div style="flex:1"></div>
      ${collageBox(false)}`, 'tall');
  },

  classbreak() {
    const s = cur();
    return `<div class="full" role="dialog" aria-modal="true" aria-labelledby="cb-h"><div class="night-screen">
      <svg class="stars" viewBox="0 0 390 300" preserveAspectRatio="xMidYMin slice" aria-hidden="true"><g fill="#FFF3C4"><circle cx="60" cy="70" r="2.5"/><circle cx="130" cy="40" r="2"/><circle cx="300" cy="60" r="2.5"/><circle cx="340" cy="130" r="2"/><circle cx="40" cy="160" r="2"/><circle cx="230" cy="100" r="1.8"/></g><path d="M318 40a26 26 0 1 0 26 34 20 20 0 1 1-26-34z" fill="#FFE39A"/></svg>
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px;position:relative">
        <span class="chip chip-night">${esc(s.chip || 'Intermission')}</span>
        <h1 id="cb-h">${esc(s.clue.split('.')[0])}.</h1>
        <p>${esc(s.resumeNote || '')}</p>
        ${slotHTML(s.companionCharacter, 'idle', { size: 'xl', label: s.title, extra: 'night' })}
        ${audio.has(voiceKey(s, 'voice', 0)) ? `<button class="btn btn-night" style="border-radius:25px" data-act="speak" data-key="${voiceKey(s, 'voice', 0)}">${icons.play(16)} “${esc(s.voiceLines[0])}”</button>` : `<p style="font-style:italic">“${esc(s.voiceLines[0])}”</p>`}
      </div>
      <div style="width:100%;display:flex;flex-direction:column;align-items:center;gap:10px;position:relative">
        <button class="btn btn-amber btn-lg btn-block" data-act="resume">${esc(s.resumeLabel || 'I’m out of class')}!</button>
        ${s.footnote ? `<p>${esc(s.footnote)}</p>` : ''}
      </div>
    </div></div>`;
  },

  finale() {
    if (!letterShown()) {
      return `<div class="full letter-final-screen" role="dialog" aria-modal="true" aria-labelledby="fin-h"><div class="finale finale-sealed">
        <span class="chip chip-green">${doneCount()} of ${numbered().length} · Hunt complete!</span>
        ${pawRow()}
        ${slotHTML('finale-group', 'success', { size: 'wide', label: 'Group portrait: Avatar friends and three ponies' })}
        <section class="sealed-card">
          <h1 id="fin-h" tabindex="-1">One last thingie</h1>
          ${letterDeliveryHTML()}
        </section>
        <button class="btn btn-ghost" data-act="finale-close">${icons.trail(16)} Back to the map</button>
      </div></div>`;
    }
    const L = cfg.letter;
    const paras = String(L.body || '').split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join('');
    return `<div class="full letter-final-screen" role="dialog" aria-modal="true" aria-labelledby="fin-h"><div class="finale">
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
        <span class="chip chip-green">${doneCount()} of ${numbered().length} · Hunt complete!</span>
        ${pawRow()}
        ${slotHTML('finale-group', 'success', { size: 'wide', label: 'Group portrait: Avatar friends and three ponies' })}
      </div>
      <article class="letter">
        <h1 id="fin-h" tabindex="-1">${esc(L.heading || 'For you')}</h1>
        <div class="body">${paras}</div>
        <p class="sign">${esc(L.signoff || '')}</p>
        ${audio.has('letter') ? `<button class="btn btn-outline" data-act="speak" data-key="letter">${icons.mic(18)} Play my voice note</button>` : ''}
      </article>
      ${collageBox(true)}
      ${talkEnabled(cfg) ? `<button class="btn btn-outline" data-act="talk">${icons.mic(18)} Talk to ${esc(cfg.talk.name || 'Sahith')}</button>` : ''}
      <button class="btn btn-ghost" data-act="letter-close">Back to the envelope</button>
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
      <p class="sheet-sub" style="text-align:center">Made with love for ${esc(cfg.birthday.name)}${TEST ? ' · practice mode' : ''}</p>
      <p class="sheet-sub" style="text-align:center;font-size:12px">Map data © OpenFreeMap, OpenMapTiles and OpenStreetMap contributors</p>`);
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
      <p class="sheet-sub">No location? No problem. Your paper clues and hints still work, and you can always tap to go to the next one.</p>
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
  clearLetterDelivery();
  characters.destroyIn(ov);
  audio.stop();
  overlay = { name, opts };
  ov.innerHTML = OV[name](opts);
  $('#scr-map')?.classList.toggle('ov-full', ['classbreak', 'finale'].includes(name));
  ov.hidden = false;
  characters.mountIn(ov);
  hydratePhotos(ov);
  hydrateCollage(ov);
  if (name === 'settings') offlineStatus();
  if (name === 'finale' && !letterShown()) {
    const deliveryRoot = ov.querySelector('[data-letter-delivery]');
    if (deliveryRoot) {
      const ctl = mountLetterDelivery(deliveryRoot, { reducedMotion, onOpen() {
        if (letterDelivery !== ctl || overlay?.name !== 'finale' || !deliveryRoot.isConnected) return;
        if (cfg.letter.sealed && !letterReady()) { askLetterCode(); return; }
        showEnvelope = false;
        progress.letterOpened = progress.letterOpened || Date.now(); saveProgress(); rerender();
      } });
      letterDelivery = ctl;
    }
  }
  const focusEl = name === 'finale' ? ov.querySelector('#fin-h') : ov.querySelector('[data-act="close"], .btn');
  try { focusEl && focusEl.focus({ preventScroll: true }); } catch {}
}
function closeOverlay() {
  const ov = $('#ov');
  if (!ov || !overlay) return;
  if (overlay.name === 'classbreak') return; // only “I’m out of class” closes it
  clearLetterDelivery();
  if (overlay.name === 'talk') detachTalk();
  audio.stop();
  characters.destroyIn(ov);
  ov.hidden = true; ov.innerHTML = ''; overlay = null; $('#scr-map')?.classList.remove('ov-full');
  refresh();
}
function rerender() { if (overlay) { const st = $('#ov .sheet')?.scrollTop; openOverlay(overlay.name, overlay.opts); const sh = $('#ov .sheet'); if (sh && st) sh.scrollTop = st; } }

async function hydratePhotos(root) {
  for (const el of root.querySelectorAll('[data-photo]')) {
    const u = await photos.url(el.dataset.photo);
    if (u) { el.style.backgroundImage = `url("${u}")`; el.innerHTML = ''; const l = root.querySelector(`[data-photo-label="${el.dataset.photo}"]`); if (l) l.textContent = 'Retake photo'; }
  }
  let n = 0;
  for (const el of root.querySelectorAll('[data-photo-tile]')) {
    const u = await photos.url(el.dataset.photoTile);
    if (u) { n++; el.outerHTML = `<button class="ph" data-act="photo" data-stop="${el.dataset.photoTile}" style="background-image:url('${u}')" aria-label="Replace this photo"></button>`; }
  }
  const c = root.querySelector('#album-count');
  if (c) c.textContent = n ? `${n} moment${n === 1 ? '' : 's'} saved on this phone` : 'Saved only on this phone';
}

/* Built when the screen opens so the tap can go straight to the share sheet: iOS rejects a share after a long wait. */
let collageFile = null, collageRun = 0, collageUrl = null;
async function hydrateCollage(root) {
  const box = root.querySelector('[data-collage]');
  if (!box) return;
  const run = ++collageRun;
  collageFile = null;
  const blob = await photos.collage(photoStops().map((s) => s.id), `${cfg.birthday.name}’s ${cfg.birthday.age}rd birthday · Nov 9, 2026`);
  if (run !== collageRun || !box.isConnected || !blob) return;
  collageFile = new File([blob], 'akhis-birthday-collage.jpg', { type: 'image/jpeg' });
  const img = box.querySelector('img');
  if (img) { if (collageUrl) URL.revokeObjectURL(collageUrl); collageUrl = URL.createObjectURL(blob); img.src = collageUrl; }
  box.hidden = false;
}
async function saveCollage() {
  const file = collageFile;
  if (!file) { toast('Still making your collage…'); return; }
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (err) { if (err && err.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  toast('Collage saved');
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
/** One tap: completes exactly the current stop and moves on once. */
function completeStop(id) {
  const now = Date.now();
  const s = cur();
  if (!s || s.intermission || s.id !== id || progress.done[s.id] || now < advanceLockUntil) return;
  advanceLockUntil = now + ADVANCE_LOCK_MS;
  progress.done[s.id] = now;
  if (!current()) progress.finishedAt = now;
  saveProgress();
  if (navigator.vibrate) navigator.vibrate(80);
  const from = $('#ov .char-slot')?.getBoundingClientRect();
  closeOverlayForce();
  audio.play(voiceKey(s, 'sfx'));
  foundBurst(s, from, () => showNext());
}

/** Shows whatever comes next: refresh() opens a pause or the finale; otherwise the next clue. */
function showNext(sfxKey) {
  refresh();
  const next = cur();
  if (!next || next.intermission) { if (sfxKey) audio.play(sfxKey); return; }
  openOverlay('clue');
  const voice = voiceKey(next, 'voice', 0);
  (async () => {
    if (sfxKey) await audio.play(sfxKey);
    if (overlay && overlay.name === 'clue' && !audio.current && cur()?.id === next.id) audio.play(voice);
  })();
}

/** The character circle fills the screen and plays its animation, then asks for a photo. Saving it, or the X, closes onto the next clue. */
const BURST_OPEN_MS = 560, BURST_PLAY_MS = 1500, BURST_HOLD_MS = 700, BURST_CLOSE_MS = 480, BURST_CALM_MS = 1800;
function foundBurst(s, from, next) {
  const calm = reducedMotion();
  const box = document.createElement('div');
  box.className = 'found-burst';
  box.setAttribute('role', 'status');
  const headline = s.number ? cfg.reactions.unlock.replace('{n}', s.number) : 'Paw-some! You solved it!';
  box.innerHTML = `<div class="found-burst-inner">${slotHTML(s.completeCharacter || s.companionCharacter, 'idle', { size: 'xl', extra: 'burst-slot' })}
    <h2>${esc(headline)}</h2><p>${esc(s.foundLabel)}</p>${s.number ? pawRow(s.id) : ''}
    ${s.photoPrompt ? `<div class="burst-photo"><p>${esc(s.photoPrompt)}</p><button class="btn btn-amber btn-lg btn-block burst-take">${icons.camera(22)} Take a picture</button></div>` : ''}</div>
    <button class="icon-btn burst-x" aria-label="Close">${icons.close(22)}</button>`;
  document.body.appendChild(box);
  characters.mountIn(box);
  const x = from ? from.left + from.width / 2 : innerWidth / 2;
  const y = from ? from.top + from.height / 2 : innerHeight * 0.4;
  const full = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 8;
  const clip = (r) => `circle(${r}px at ${x}px ${y}px)`;
  const remove = () => { characters.destroyIn(box); box.remove(); };
  let closed = false, cueT = 0, readyT = 0, closeT = 0;
  const close = () => {
    if (closed) return;
    closed = true;
    afterPhoto = null;
    clearTimeout(cueT); clearTimeout(readyT); clearTimeout(closeT);
    next();
    if (calm) { remove(); return; }
    box.style.pointerEvents = 'none';
    box.animate({ clipPath: [clip(full), clip(0)] }, { duration: BURST_CLOSE_MS, easing: 'ease-in', fill: 'forwards' });
    setTimeout(remove, BURST_CLOSE_MS + 40);
  };
  box.querySelector('.burst-x').addEventListener('click', close);
  box.querySelector('.burst-take')?.addEventListener('click', () => { afterPhoto = close; actions.photo({ dataset: { stop: s.id, camera: '1' } }); });
  const ready = () => {
    box.classList.add('ready');
    if (!s.photoPrompt) closeT = setTimeout(close, calm ? BURST_CALM_MS : BURST_HOLD_MS); // nothing to photograph
  };
  if (calm) { ready(); return; }
  box.animate({ clipPath: [clip(from ? from.width / 2 : 40), clip(full)] }, { duration: BURST_OPEN_MS, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
  cueT = setTimeout(() => characters.cue(box, 'success'), BURST_OPEN_MS);
  readyT = setTimeout(ready, BURST_OPEN_MS + BURST_PLAY_MS);
}

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
  clue() { openOverlay(cur() ? 'clue' : 'finale'); },
  recap(b) { openOverlay('clue', { id: b.dataset.stop }); },
  sealed() { toast('Sealed until you get there'); },
  hints() { openOverlay('hints'); },
  'more-hint'() {
    const s = cur();
    progress.hints[s.id] = Math.min((progress.hints[s.id] || 0) + 1, s.hints.length); saveProgress();
    rerender();
    characters.cue($('#ov'), 'hint');
    const k = voiceKey(s, 'hint', progress.hints[s.id] - 1);
    audio.play(k);
    const sh = $('#ov .sheet'); const hs = sh && sh.querySelectorAll('.hint'); if (hs && hs.length) hs[hs.length - 1].scrollIntoView({ block: 'nearest', behavior: prefs.calm ? 'auto' : 'smooth' });
  },
  complete(b) { completeStop(b.dataset.stop); },
  resume() {
    const s = cur();
    const now = Date.now();
    if (!s || !s.intermission || now < advanceLockUntil) return;
    advanceLockUntil = now + ADVANCE_LOCK_MS;
    progress.done[s.id] = now; saveProgress();
    closeOverlayForce();
    showNext();
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
  'skip-stop'() { const s = cur(); if (!s) return; closeOverlayForce(); if (s.intermission) { progress.done[s.id] = Date.now(); saveProgress(); refresh(); } else { advanceLockUntil = 0; completeStop(s.id); } },
  'reset-practice'() {
    if (!confirm('Reset practice progress and practice photos?')) return;
    progress = freshProgress(); progress.introSeen = true; progress.started = true; saveProgress();
    photos.clear(cfg.stops.map((s) => s.id));
    closeOverlayForce(); refresh(); toast('Practice reset');
  },
  'open-letter'() { if (letterDelivery) { void letterDelivery.open(); return; } progress.letterOpened = Date.now(); saveProgress(); rerender(); },
  'letter-close'() { showEnvelope = true; rerender(); },
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
    if (b.dataset.camera) input.setAttribute('capture', 'environment'); else input.removeAttribute('capture');
    input.click();
  },
  'save-collage'() { saveCollage(); },
};
function closeOverlayForce() { const ov = $('#ov'); if (!ov) return; clearLetterDelivery(); if (overlay && overlay.name === 'talk') detachTalk(); audio.stop(); characters.destroyIn(ov); ov.hidden = true; ov.innerHTML = ''; overlay = null; $('#scr-map')?.classList.remove('ov-full'); }

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a || a.disabled) return;
  const fn = actions[a.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(a, e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeOverlay(); return; }
  if (e.key !== 'Tab' || overlay?.name !== 'finale') return;
  const dialog = $('#ov .full');
  if (!dialog) return;
  const items = [...dialog.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')]
    .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (!items.length) return;
  const first = items[0], last = items.at(-1), active = document.activeElement;
  if (!items.includes(active) || (!e.shiftKey && active === last) || (e.shiftKey && active === first)) {
    e.preventDefault(); (e.shiftKey ? last : first).focus();
  }
});

$('#photo-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file || !photoStop) return;
  try {
    await photos.save(photoStop, file);
    toast('Saved to your album');
    characters.cue($('#ov'), 'success');
    audio.sfx('sfx.purr');
    if (overlay) rerender();
    if (afterPhoto) afterPhoto();
  } catch { toast('Couldn’t save that photo. Try again?'); }
  photoStop = null;
});

function onVisibility() {
  if (document.hidden) { audio.stop(); endTalk(); characters.pauseAll(); stopGeo(); if (!geo.fake) geo.pos = null; $('#intro-video')?.pause(); }  // no stale fix on return
  else if (progress.started && $('#scr-map')) startGeo();
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
    if (overlay && overlay.name === 'talk') return;
    if (photoStop) return;
    reloaded = true;
    location.reload();
  });
}

boot();
