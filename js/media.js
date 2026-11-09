// Audio manager, photo store (IndexedDB) and character-slot adapter bridge.
import { paw } from './icons.js';

/* ------------------------------------------------------------------ audio */
// media/audio/manifest.json → { "files": { "<key>": "media/audio/<file>.mp3" } }
// Keys: welcome.voice.0 · stop.<id>.voice.0 · stop.<id>.hint.<i> · stop.<id>.sfx
//       reaction.<warmer|colder|here|unlock|wrongCode> · sfx.<purr|unlock|tap|wrong> · letter
export const audio = {
  files: {},
  muted: false,
  current: null,
  token: 0,
  blobs: new Map(),
  listeners: new Set(),

  async init() {
    try { this.muted = localStorage.getItem('akhi-muted') === '1'; } catch {}
    try {
      const res = await fetch('media/audio/manifest.json', { cache: 'no-cache' });
      if (res.ok) this.files = (await res.json()).files || {};
    } catch { /* no audio yet — everything still works as text */ }
  },
  has(key) { return Boolean(this.files[key]); },
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(state, key) { this.listeners.forEach((fn) => { try { fn(state, key); } catch {} }); },

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('akhi-muted', m ? '1' : '0'); } catch {}
    if (m) this.stop();
    document.querySelectorAll('video').forEach((v) => { v.muted = m; });
  },

  stop() {
    this.token++;
    if (this.current) {
      const { el, key } = this.current;
      try { el.pause(); } catch {}
      this.current = null;
      this.emit('stop', key);
    }
  },

  /** Plays one clip at a time. Resolves true when it finished, false if skipped/failed. */
  async play(key) {
    this.stop();
    if (this.muted || !this.has(key)) return false;
    const my = ++this.token;
    try {
      let url = this.blobs.get(key);
      if (!url) {
        // Fetching as a blob lets the service worker serve it offline (Safari range requests bypass caches).
        const res = await fetch(this.files[key]);
        if (!res.ok) throw new Error('missing');
        url = URL.createObjectURL(await res.blob());
        this.blobs.set(key, url);
      }
      if (my !== this.token) return false;
      const el = new Audio(url);
      this.current = { el, key };
      this.emit('start', key);
      await el.play();
      await new Promise((resolve) => { el.onended = resolve; el.onpause = resolve; el.onerror = resolve; });
      if (this.current && this.current.el === el) { this.current = null; this.emit('stop', key); }
      return my === this.token;
    } catch {
      if (this.current && this.current.key === key) this.current = null;
      this.emit('stop', key);
      return false;
    }
  },
  sfx(name) { if (!this.current) this.play(name); },
};

/* ----------------------------------------------------------------- photos */
const DB_NAME = 'akhi-hunt';
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('photos', mode);
    const out = fn(t.objectStore('photos'));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function resize(file, max = 1600) {
  const src = await decode(file);
  const w = src.width, h = src.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.86));
}

const loadImage = (blob) => new Promise((ok, fail) => {
  const im = new Image();
  im.onload = () => ok(im); im.onerror = fail;
  im.src = URL.createObjectURL(blob);
});
/** Rounded cell, photo cropped to fill it. */
function drawCover(g, im, x, y, w, h) {
  const k = Math.max(w / im.naturalWidth, h / im.naturalHeight);
  const sw = w / k, sh = h / k;
  g.save();
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, 28); else g.rect(x, y, w, h);
  g.clip();
  g.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  g.restore();
}

export const photos = {
  prefix: '',
  urls: new Map(),
  async save(stopId, file) {
    const blob = await resize(file);
    await tx('readwrite', (st) => st.put({ blob, takenAt: Date.now() }, this.prefix + stopId));
    this.urls.delete(stopId);
    try { await navigator.storage?.persist?.(); } catch {}
    return blob;
  },
  async get(stopId) {
    try { const v = await tx('readonly', (st) => st.get(this.prefix + stopId)); return v ? v.blob : null; } catch { return null; }
  },
  async url(stopId) {
    if (this.urls.has(stopId)) return this.urls.get(stopId);
    const b = await this.get(stopId);
    const u = b ? URL.createObjectURL(b) : null;
    if (u) this.urls.set(stopId, u);
    return u;
  },
  /** One JPEG of every saved photo, or null if there are none yet. */
  async collage(ids, caption) {
    const blobs = (await Promise.all(ids.map((id) => this.get(id)))).filter(Boolean);
    const loaded = await Promise.allSettled(blobs.map(loadImage));
    const imgs = loaded.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!imgs.length) return null;
    const W = 1080, H = 1350, PAD = 36, GAP = 20, FOOT = 84;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#CFE6FF'; g.fillRect(0, 0, W, H);
    const rows = { 1: [1], 2: [1, 1], 3: [1, 2], 4: [2, 2], 5: [2, 3], 7: [2, 3, 2] }[imgs.length] || [2, 2, 2];
    const rowH = (H - PAD - FOOT - GAP * (rows.length - 1)) / rows.length;
    let n = 0;
    rows.forEach((cols, r) => {
      const cellW = (W - PAD * 2 - GAP * (cols - 1)) / cols;
      for (let i = 0; i < cols; i++) drawCover(g, imgs[n++], PAD + i * (cellW + GAP), PAD + r * (rowH + GAP), cellW, rowH);
    });
    imgs.forEach((im) => URL.revokeObjectURL(im.src));
    const font = getComputedStyle(document.documentElement).getPropertyValue('--display').trim() || 'sans-serif';
    g.fillStyle = '#2A2D3E'; g.font = `600 38px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(caption, W / 2, H - FOOT / 2);
    return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
  },
  async clear(ids) { for (const id of ids) { try { await tx('readwrite', (st) => st.delete(this.prefix + id)); } catch {} this.urls.delete(id); } },
};

/* ------------------------------------------------------------- characters */
// Codex supplies characters/character-player.js. Contract (see characters/ADAPTER.md):
//   export function mount(el, { character, cue, reducedMotion }) → { setCue(cue), setReducedMotion(b), pause(), destroy() }
// Missing adapter or any adapter error → the dashed placeholder stays. Never blocks the hunt.
export const CHARACTER_NAMES = {
  leopard: 'Leopard', aang: 'Aang', katara: 'Katara', toph: 'Toph', zuko: 'Zuko',
  'twilight-sparkle': 'Twilight Sparkle', 'pinkie-pie': 'Pinkie Pie', fluttershy: 'Fluttershy',
  'rainbow-dash': 'Rainbow Dash', rarity: 'Rarity', applejack: 'Applejack', group: 'Everyone',
};
export const CUES = ['idle', 'enter', 'hint', 'warmer', 'error', 'success', 'speak-start', 'speak-stop'];

export function slotHTML(character = 'leopard', cue = 'idle', { size = 'md', label, extra = '' } = {}) {
  const guest = character && character !== 'leopard';
  const text = label || (guest ? `Leopard + ${CHARACTER_NAMES[character] || character}` : 'Leopard');
  const pw = { xs: 18, sm: 28, md: 34, lg: 46, xl: 50, wide: 28 }[size] || 30;
  return `<div class="char-slot s-${size} ${extra}" data-character="${character || 'leopard'}" data-cue="${cue}" role="img" aria-label="${text}"><span class="slot-ph">${paw(pw)}<span class="slot-label">${text}</span></span></div>`;
}

// Inline SVG art reuses ids (e.g. #fur). With several copies on the page, url(#fur) resolves to the
// first copy, which may sit in a hidden container and then paints nothing. Give each copy its own ids.
let svgUid = 0;
function uniquifySvgIds(slot) {
  const fix = () => {
    const svgs = slot.querySelectorAll('svg:not([data-uid])');
    svgs.forEach((svg) => {
      const u = `c${++svgUid}`;
      svg.dataset.uid = u;
      const map = {};
      svg.querySelectorAll('[id]').forEach((n) => { map[n.id] = `${n.id}-${u}`; n.id = map[n.id]; });
      if (!Object.keys(map).length) return;
      svg.querySelectorAll('*').forEach((n) => {
        for (const a of ['fill', 'stroke', 'mask', 'clip-path', 'filter', 'href', 'xlink:href']) {
          const v = n.getAttribute(a);
          if (!v) continue;
          const nv = v.replace(/url\(#([^)]+)\)/g, (m, id) => (map[id] ? `url(#${map[id]})` : m)).replace(/^#(.+)$/, (m, id) => (map[id] ? `#${map[id]}` : m));
          if (nv !== v) n.setAttribute(a, nv);
        }
      });
    });
  };
  fix();
  const mo = new MutationObserver(fix);
  mo.observe(slot, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 15000);
}

export const characters = {
  adapter: null,
  reduced: false,
  live: new Set(),
  async load() {
    try {
      const head = await fetch('characters/character-player.js', { method: 'HEAD' });
      if (!head.ok) return;
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'characters/characters.css';
      document.head.appendChild(css);
      const mod = await import('../characters/character-player.js');
      this.adapter = mod.default && mod.default.mount ? mod.default : mod;
    } catch { this.adapter = null; }
  },
  mountIn(root) {
    if (!this.adapter || !root) return;
    root.querySelectorAll('.char-slot:not([data-mounted])').forEach((el) => {
      try {
        const ctl = this.adapter.mount(el, { character: el.dataset.character, cue: el.dataset.cue || 'idle', reducedMotion: this.reduced });
        if (ctl) { el._ctl = ctl; el.dataset.mounted = '1'; this.live.add(el); uniquifySvgIds(el); }
      } catch { /* keep placeholder */ }
    });
  },
  cue(root, cue) {
    (root || document).querySelectorAll('.char-slot[data-mounted]').forEach((el) => { try { el._ctl.setCue(cue); } catch {} });
  },
  destroyIn(root) {
    if (!root) return;
    root.querySelectorAll('.char-slot[data-mounted]').forEach((el) => { try { el._ctl.destroy(); } catch {} this.live.delete(el); });
  },
  setReducedMotion(b) {
    this.reduced = b;
    this.live.forEach((el) => { try { el._ctl.setReducedMotion(b); } catch {} });
  },
  pauseAll() { this.live.forEach((el) => { try { el._ctl.pause(); } catch {} }); },
  sweep() { this.live.forEach((el) => { if (!el.isConnected) { try { el._ctl.destroy(); } catch {} this.live.delete(el); } }); },
};
