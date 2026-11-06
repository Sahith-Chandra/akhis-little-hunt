// #organizer — for the birthday organizer only. Pins, lunch/gathering switches, the letter,
// progress fixes, and a setup link that copies these settings onto Akhi’s phone.
import { icons } from './icons.js';

export function renderOrganizer(root, ctx) {
  const { esc } = ctx;
  let o = ctx.getOverrides();
  o.pins = o.pins || {};
  const save = () => { ctx.setOverrides(o); };
  const cfg = () => ctx.stops();
  const L = { ...ctx.base.letter, ...(o.letter || {}) };

  const pinCard = (s) => {
    if (s.intermission) return '';
    if (s.home) return `<div class="card"><b>${s.number}. ${esc(s.title)}</b><span class="sheet-sub">At home: no pin needed, which keeps your address out of the app.</span></div>`;
    const p = o.pins[s.id] || {};
    const lat = p.lat ?? s.lat, lng = p.lng ?? s.lng, r = p.radiusM ?? s.radiusM;
    const has = lat != null && lng != null;
    return `<div class="card" data-pin="${s.id}">
      <div class="row" style="justify-content:space-between;align-items:center"><b>${s.number}. ${esc(s.title)}</b><span class="${has ? 'pin-ok' : 'pin-missing'}">${has ? 'Pinned' : 'No pin yet'}</span></div>
      <span class="sheet-sub">${esc(s.hints[s.hints.length - 1])}</span>
      <label>Lat, lng (paste from Google Maps)<input inputmode="decimal" data-f="latlng" value="${has ? `${lat}, ${lng}` : ''}" placeholder="44.5646, -123.2620"></label>
      <label>Arrival radius (meters)<input inputmode="numeric" data-f="radius" value="${r || ''}"></label>
      <div class="row"><button class="btn btn-green" data-o="here" style="flex:1">${icons.pin(16)} Use my location</button><button class="btn btn-soft" data-o="clear">Clear</button></div>
    </div>`;
  };

  function draw() {
    const stops = cfg();
    const done = ctx.progress.done || {};
    const cur = stops.find((s) => !done[s.id]);
    root.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center"><h1>Organizer${ctx.TEST ? ' · practice' : ''}</h1><button class="btn btn-outline" data-o="close">Back to hunt</button></div>
      <p class="sheet-sub">Everything here saves on <b>this phone only</b>. Set it up on Akhi’s phone directly, or send it there with <b>Copy setup link</b>.</p>

      <h2>Pins</h2>
      <p class="sheet-sub">Stand at each spot and tap <b>Use my location</b>, or paste coordinates. Without a pin the stop still works, just with no warmer/colder.</p>
      ${stops.map(pinCard).join('')}

      <h2>Lunch</h2>
      <div class="card">
        <label>Where is lunch?<select data-g="lunchMode"><option value="qdoba">Qdoba (default)</option><option value="pizza">Pizza place</option></select></label>
        <label>Pizza place name (if pizza)<input data-g="lunchPlace" value="${esc(o.lunchPlace ?? ctx.base.lunchPlace ?? '')}" placeholder="e.g. American Dream"></label>
      </div>

      <h2>Badminton</h2>
      <div class="card"><label>Where do friends gather at 4?<select data-g="gatheringMode"><option value="dixon">Dixon courts (default)</option><option value="home">Back home (rain plan)</option></select></label></div>

      <h2>Your letter</h2>
      <div class="card">
        <label>Heading<input data-l="heading" value="${esc(L.heading)}"></label>
        <label>Letter (blank line = new paragraph)<textarea data-l="body">${esc(L.body)}</textarea></label>
        <label>Sign-off<input data-l="signoff" value="${esc(L.signoff)}"></label>
        <span class="sheet-sub">The letter stays on the phone and in the setup link. It is never put in the website files.</span>
      </div>

      <h2>Progress ${ctx.TEST ? '(practice)' : '(the real hunt)'}</h2>
      <div class="card">
        <span class="sheet-sub">Now on: <b>${cur ? esc(cur.number ? `Envelope ${cur.number}: ${cur.title}` : cur.title) : 'Finished'}</b></span>
        <label>Jump to<select data-o-sel="jump">${stops.map((s, i) => `<option value="${i}" ${cur && cur.id === s.id ? 'selected' : ''}>${s.number ? `${s.number}. ` : ''}${esc(s.title)}</option>`).join('')}<option value="${stops.length}">Finished (letter)</option></select></label>
        <div class="row"><button class="btn btn-soft" data-o="jump" style="flex:1">Jump</button><button class="btn btn-soft" data-o="reset" style="flex:1">Reset progress</button></div>
      </div>

      <h2>Send to Akhi’s phone</h2>
      <div class="card">
        <button class="btn btn-amber" data-o="link">Copy setup link</button>
        <span class="sheet-sub">Open the link on her phone (AirDrop or text it to yourself, then open it on her phone) to copy pins, lunch, gathering and the letter.</span>
        <button class="btn btn-outline" data-o="download">Download hunt.json (pins + settings, no letter)</button>
        <span class="sheet-sub">To bake pins into the website: replace hunt.json in the project and redeploy.</span>
        <a class="btn btn-ghost" href="${location.pathname}?test=1">Open practice mode</a>
      </div>`;
    root.querySelector('[data-g="lunchMode"]').value = o.lunchMode ?? ctx.base.lunchMode ?? 'qdoba';
    root.querySelector('[data-g="gatheringMode"]').value = o.gatheringMode ?? ctx.base.gatheringMode ?? 'dixon';
  }

  function parseLatLng(v) {
    const m = String(v).match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const lat = +m[1], lng = +m[2];
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  }

  root.addEventListener('change', (e) => {
    const t = e.target;
    const card = t.closest('[data-pin]');
    if (card) {
      const id = card.dataset.pin;
      o.pins[id] = o.pins[id] || {};
      if (t.dataset.f === 'latlng') {
        if (!t.value.trim()) { delete o.pins[id].lat; delete o.pins[id].lng; }
        else { const p = parseLatLng(t.value); if (!p) { ctx.toast('Use “lat, lng” like 44.5646, -123.2620'); return; } Object.assign(o.pins[id], p); }
      }
      if (t.dataset.f === 'radius') { const r = parseInt(t.value, 10); if (r > 0) o.pins[id].radiusM = r; else delete o.pins[id].radiusM; }
      save(); draw(); ctx.toast('Saved'); return;
    }
    if (t.dataset.g) { o[t.dataset.g] = t.value; save(); ctx.toast('Saved'); return; }
    if (t.dataset.l) { o.letter = { ...(o.letter || {}), [t.dataset.l]: t.value }; save(); ctx.toast('Letter saved'); }
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-o]');
    if (!b) return;
    const act = b.dataset.o;
    const card = b.closest('[data-pin]');
    if (act === 'close') return ctx.close();
    if (act === 'here' && card) {
      if (!navigator.geolocation) return ctx.toast('No location on this device');
      b.disabled = true; b.textContent = 'Finding you…';
      navigator.geolocation.getCurrentPosition((p) => {
        o.pins[card.dataset.pin] = { ...(o.pins[card.dataset.pin] || {}), lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) };
        save(); draw(); ctx.toast(`Pinned (±${Math.round(p.coords.accuracy)} m)`);
      }, (err) => { draw(); ctx.toast(err.code === 1 ? 'Location permission is off' : 'Couldn’t get a fix. Try again outside'); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
      return;
    }
    if (act === 'clear' && card) { delete o.pins[card.dataset.pin]; save(); draw(); return; }
    if (act === 'jump') {
      const idx = +root.querySelector('[data-o-sel="jump"]').value;
      const p = { ...ctx.progress, done: {}, started: true, introSeen: true, finaleClosed: false };
      ctx.stops().forEach((s, i) => { if (i < idx) p.done[s.id] = Date.now(); });
      ctx.setProgress(p); ctx.progress = p; draw(); ctx.toast('Progress moved'); return;
    }
    if (act === 'reset') {
      if (!confirm(`Reset ${ctx.TEST ? 'practice' : 'REAL hunt'} progress and its photos? This can’t be undone.`)) return;
      const p = ctx.freshProgress(); ctx.setProgress(p); ctx.progress = p; await ctx.resetPhotos(); draw(); ctx.toast('Progress reset'); return;
    }
    if (act === 'link') {
      const json = JSON.stringify(o);
      const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const url = `${location.origin}${location.pathname}#setup=${b64}`;
      try { await navigator.clipboard.writeText(url); ctx.toast('Setup link copied'); }
      catch { prompt('Copy this setup link:', url); }
      return;
    }
    if (act === 'download') {
      const out = JSON.parse(JSON.stringify(ctx.base));
      for (const s of out.stops) { const p = o.pins[s.id]; if (p && !s.home) { if (p.lat != null) { s.lat = p.lat; s.lng = p.lng; } if (p.radiusM) s.radiusM = p.radiusM; } }
      for (const k of ['lunchMode', 'lunchPlace', 'gatheringMode']) if (o[k] != null) out[k] = o[k];
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
      a.download = 'hunt.json'; document.body.appendChild(a); a.click(); a.remove();
    }
  });

  draw();
}
