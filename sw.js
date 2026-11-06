// Offline pack for Akhi’s Little Hunt. Never touches IndexedDB (photos) or localStorage (progress).
// Bump on every publish that changes cached assets (v4: auto-reload on update).
const SHELL = 'akhi-shell-v8';
const RUNTIME = 'akhi-runtime-v8';
// Always bypass the browser's HTTP cache when filling the pack, so an update never captures stale files.
const fresh = (u) => new Request(u, { cache: 'reload' });
const FILES = [
  './', 'index.html', 'styles.css', 'hunt.json', 'manifest.webmanifest',
  'js/app.js', 'js/map.js', 'js/media.js', 'js/icons.js', 'js/organizer.js', 'js/talk.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-512.png',
];
const CDN = [
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
];
const OPTIONAL_JSON = ['media/audio/manifest.json', 'characters/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(FILES.map(fresh));
    for (const u of CDN) { try { await c.add(new Request(u, { mode: 'cors' })); } catch {} }
    // Pre-cache any generated audio and Codex character files listed in their manifests.
    for (const m of OPTIONAL_JSON) {
      try {
        const res = await fetch(m, { cache: 'no-cache' });
        if (!res.ok) continue;
        await c.put(m, res.clone());
        const j = await res.json();
        const list = m.startsWith('media') ? Object.values(j.files || {}) : (j.files || []);
        for (const f of list) { try { await c.add(fresh(f)); } catch {} }
      } catch {}
    }
    for (const f of ['characters/character-player.js', 'characters/characters.css', 'media/dora-birthday-intro-poster.png', 'media/dora-birthday-intro.vtt']) {
      try { await c.add(fresh(f)); } catch {}
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('akhi-') && k !== SHELL && k !== RUNTIME) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return; // let Safari stream video natively
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;

  // Fresh config/manifests when online, cached when not.
  if (same && (req.mode === 'navigate' || /\/(hunt|manifest)\.json$|\.webmanifest$/.test(url.pathname))) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) (await caches.open(SHELL)).put(req.mode === 'navigate' ? 'index.html' : req, res.clone());
        return res;
      } catch {
        return (await caches.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }

  if (same) {
    if (url.pathname.endsWith('.mp4')) return;
    // Stale-while-revalidate for app files so updates arrive on the next open.
    e.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      const net = fetch(req, { cache: 'no-cache' }).then(async (res) => {
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await net) || new Response('', { status: 404 });
    })());
    return;
  }

  // Map tiles, fonts, glyphs, CDN: cache what she has already seen.
  if (/openfreemap\.org|fonts\.(googleapis|gstatic)\.com|unpkg\.com/.test(url.host)) {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      const net = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()); trim(cache, 2500); }
        return res;
      }).catch(() => null);
      return cached || (await net) || Response.error();
    })());
  }
});
