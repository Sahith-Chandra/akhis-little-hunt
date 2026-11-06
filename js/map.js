// Live cartoon map: MapLibre GL + OpenFreeMap vector tiles restyled in the hunt palette,
// tilted like a game map. Falls back to the illustrated map if WebGL/network is unavailable.
import { slotHTML, characters } from './media.js';

export const DEFAULT_CENTER = [-123.2794, 44.5638]; // OSU campus, Corvallis
const TILES = 'https://tiles.openfreemap.org/planet';

const ROAD_MAJOR = ['motorway', 'trunk', 'primary'];
const ROAD_MID = ['secondary', 'tertiary'];
const ROADS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track'];

function roadWidth(scale) {
  return ['interpolate', ['exponential', 1.6], ['zoom'],
    12, ['*', scale, ['match', ['get', 'class'], ROAD_MAJOR, 3, ROAD_MID, 2.2, 1.2]],
    18, ['*', scale, ['match', ['get', 'class'], ROAD_MAJOR, 40, ROAD_MID, 32, ['minor'], 24, 14]]];
}

export function cartoonStyle() {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { omt: { type: 'vector', url: TILES } },
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0.3, position: [1.2, 200, 40] },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#BFE3A0' } },
      { id: 'landuse-town', type: 'fill', source: 'omt', 'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood', 'commercial', 'retail']]],
        paint: { 'fill-color': '#C8E7AA' } },
      { id: 'landuse-campus', type: 'fill', source: 'omt', 'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['school', 'university', 'college']]],
        paint: { 'fill-color': '#D3ECB5' } },
      { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'farmland', 'wetland']]],
        paint: { 'fill-color': ['match', ['get', 'class'], 'wood', '#93CB78', '#A9D78B'] } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#A9D78B' } },
      { id: 'pitch', type: 'fill', source: 'omt', 'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['pitch', 'stadium', 'playground']]],
        paint: { 'fill-color': '#9ED27E', 'fill-outline-color': '#F3FBEA' } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#7FC8EC' } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
        paint: { 'line-color': '#7FC8EC', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 18, 8] } },
      { id: 'paths', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 14,
        filter: ['==', ['get', 'class'], 'path'],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#F6EBCB', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 5], 'line-dasharray': [1.5, 1] } },
      { id: 'road-casing', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ROADS]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#E2CFA0', 'line-width': roadWidth(1) } },
      { id: 'road-fill', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ROADS]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FFF7E2', 'line-width': roadWidth(0.7) } },
      { id: 'buildings', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14,
        paint: {
          'fill-extrusion-color': ['step', ['coalesce', ['get', 'render_height'], 6],
            '#F6ECD6', 7, '#FBD9C4', 11, '#DDE6F7', 18, '#F9D6E4', 30, '#E7DDFB'],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.96,
        } },
      { id: 'road-labels', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 15,
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'minor']]],
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-max-angle': 30 },
        paint: { 'text-color': '#8A7A55', 'text-halo-color': '#FFF7E2', 'text-halo-width': 2 } },
      // hunt zone (filled by setZone)
      { id: 'zone-fill', type: 'fill', source: 'zone', paint: { 'fill-color': '#F5A623', 'fill-opacity': 0.18 } },
      { id: 'zone-line', type: 'line', source: 'zone',
        paint: { 'line-color': '#F5A623', 'line-width': 4, 'line-dasharray': [1.6, 1.2] } },
    ].map((l) => l),
  };
}

/* geo helpers */
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function offsetM(p, bearingDeg, meters) {
  const br = rad(bearingDeg), d = meters / R, la = rad(p.lat), lo = rad(p.lng);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(br));
  const lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return { lat: (la2 * 180) / Math.PI, lng: (lo2 * 180) / Math.PI };
}
function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

/** The search zone: a circle that contains the pin but isn't centered on it. */
export function zoneFor(stop) {
  const radius = Math.max(stop.zoneM || 110, (stop.radiusM || 40) * 2.5);
  const center = offsetM({ lat: stop.lat, lng: stop.lng }, hash(stop.id) * 360, radius * 0.45);
  return { center, radius };
}
function circle(center, radius, n = 64) {
  const ring = [];
  for (let i = 0; i <= n; i++) { const p = offsetM(center, (i / n) * 360, radius); ring.push([p.lng, p.lat]); }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }] };
}
const EMPTY = { type: 'FeatureCollection', features: [] };

/* illustrated fallback (same art as the design canvas) */
export const ILLUSTRATION = `<div class="tilt"><svg width="640" height="1100" viewBox="0 0 640 1100" aria-hidden="true"><rect width="640" height="1100" fill="#BFE3A0"/><ellipse cx="150" cy="290" rx="130" ry="85" fill="#A9D78B"/><ellipse cx="470" cy="830" rx="150" ry="95" fill="#A9D78B"/><ellipse cx="90" cy="980" rx="110" ry="70" fill="#A9D78B"/><path d="M520 -20 C 610 200, 470 380, 560 560 S 520 900, 630 1120" stroke="#7FC8EC" stroke-width="78" fill="none" stroke-linecap="round"/><path d="M520 -20 C 610 200, 470 380, 560 560 S 520 900, 630 1120" stroke="#A8DCF4" stroke-width="44" fill="none" stroke-linecap="round"/><g fill="none" stroke-linecap="round" stroke="#E2CFA0" stroke-width="32"><path d="M -20 420 C 200 400, 400 440, 660 410"/><path d="M 300 -20 C 280 300, 330 700, 290 1120"/><path d="M -20 760 C 200 780, 380 720, 660 760"/><path d="M 120 -20 L 140 1120"/><path d="M 300 560 L 500 640"/></g><g fill="none" stroke-linecap="round" stroke="#FFF7E2" stroke-width="22"><path d="M -20 420 C 200 400, 400 440, 660 410"/><path d="M 300 -20 C 280 300, 330 700, 290 1120"/><path d="M -20 760 C 200 780, 380 720, 660 760"/><path d="M 120 -20 L 140 1120"/><path d="M 300 560 L 500 640"/></g><g fill="#D8C6A2"><rect x="170" y="156" width="72" height="54" rx="10"/><rect x="186" y="236" width="52" height="44" rx="10"/><rect x="348" y="150" width="84" height="62" rx="10"/><rect x="360" y="260" width="62" height="52" rx="10"/><rect x="168" y="486" width="64" height="62" rx="10"/><rect x="352" y="476" width="72" height="54" rx="10"/><rect x="182" y="610" width="54" height="52" rx="10"/><rect x="40" y="500" width="62" height="52" rx="10"/><rect x="180" y="830" width="72" height="54" rx="10"/><rect x="350" y="850" width="62" height="62" rx="10"/><rect x="186" y="946" width="62" height="52" rx="10"/><rect x="30" y="852" width="62" height="52" rx="10"/></g><rect x="170" y="146" width="72" height="54" rx="10" fill="#F6ECD6"/><rect x="186" y="226" width="52" height="44" rx="10" fill="#FBD9C4"/><rect x="348" y="140" width="84" height="62" rx="10" fill="#F6ECD6"/><rect x="360" y="250" width="62" height="52" rx="10" fill="#DDE6F7"/><rect x="168" y="476" width="64" height="62" rx="10" fill="#F6ECD6"/><rect x="352" y="466" width="72" height="54" rx="10" fill="#FBD9C4"/><rect x="182" y="600" width="54" height="52" rx="10" fill="#DDE6F7"/><rect x="40" y="490" width="62" height="52" rx="10" fill="#F6ECD6"/><rect x="180" y="820" width="72" height="54" rx="10" fill="#F6ECD6"/><rect x="350" y="840" width="62" height="62" rx="10" fill="#FBD9C4"/><rect x="186" y="936" width="62" height="52" rx="10" fill="#DDE6F7"/><rect x="30" y="842" width="62" height="52" rx="10" fill="#F6ECD6"/><g><circle cx="90" cy="268" r="20" fill="#5FA548"/><circle cx="88" cy="262" r="18" fill="#7DBE5F"/><circle cx="132" cy="312" r="16" fill="#5FA548"/><circle cx="130" cy="307" r="14" fill="#7DBE5F"/><circle cx="212" cy="330" r="18" fill="#5FA548"/><circle cx="210" cy="324" r="16" fill="#7DBE5F"/><circle cx="60" cy="330" r="15" fill="#5FA548"/><circle cx="58" cy="325" r="13" fill="#7DBE5F"/><circle cx="450" cy="800" r="20" fill="#5FA548"/><circle cx="448" cy="794" r="18" fill="#7DBE5F"/><circle cx="500" cy="860" r="16" fill="#5FA548"/><circle cx="498" cy="855" r="14" fill="#7DBE5F"/><circle cx="420" cy="880" r="14" fill="#5FA548"/><circle cx="418" cy="875" r="12" fill="#7DBE5F"/><circle cx="70" cy="960" r="18" fill="#5FA548"/><circle cx="68" cy="954" r="16" fill="#7DBE5F"/><circle cx="430" cy="560" r="14" fill="#5FA548"/><circle cx="428" cy="555" r="12" fill="#7DBE5F"/></g></svg></div>`;

export function meHTML() {
  return `<div class="me"><div class="me-ring"></div>${slotHTML('leopard', 'idle', { size: 'xs', label: 'You' })}</div>`;
}
export function envMarkerHTML(n, label) {
  return `<div class="env-marker"><div class="env">${n}</div><div class="shadow"></div>${label ? `<div class="zone-label">${label}</div>` : ''}</div>`;
}

/**
 * createMap(container, { onUserMove, onTap }) → controller
 *   setPlayer({lat,lng}|null) · setZone({center,radius,n,label}|null) · recenter() · focus() · live
 */
export function createMap(container, { onUserMove, onTap } = {}) {
  container.innerHTML = `<div class="map-fallback">${ILLUSTRATION}<div class="sky-fog"></div><div class="fake-zone" hidden></div><div class="fake-env" hidden></div><div class="fake-me">${meHTML()}</div></div><div id="map"></div><div class="sky-fog" id="map-fog" hidden></div>`;
  const fb = container.querySelector('.map-fallback');
  characters.mountIn(fb);
  const ctl = { live: false, following: true, player: null, zone: null };
  let map = null, meMarker = null, envMarker = null, ready = false;

  const fakeZone = fb.querySelector('.fake-zone');
  const fakeEnv = fb.querySelector('.fake-env');
  function paintFallback() {
    fakeZone.hidden = !ctl.zone;
    fakeEnv.hidden = !ctl.zone;
    if (ctl.zone) {
      fakeEnv.innerHTML = envMarkerHTML(ctl.zone.n, ctl.zone.label);
      Object.assign(fakeEnv.style, { position: 'absolute', left: '50%', top: '27%', transform: 'translateX(-50%)' });
    }
  }

  const gl = window.maplibregl;
  let webgl = false;
  try { webgl = !!gl && gl.supported ? gl.supported() : !!gl; } catch { webgl = !!gl; }
  if (gl && webgl) {
    try {
      const style = cartoonStyle();
      style.sources.zone = { type: 'geojson', data: EMPTY };
      map = new gl.Map({
        container: container.querySelector('#map'),
        style,
        center: DEFAULT_CENTER,
        zoom: 16.4,
        pitch: 58,
        maxPitch: 70,
        bearing: 0,
        attributionControl: false,
        dragRotate: true,
        pitchWithRotate: false,
        fadeDuration: 0,
      });
      map.addControl(new gl.AttributionControl({ compact: true }), 'top-right');
      map.on('load', () => {
        container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        ready = true; ctl.live = true;
        fb.hidden = true; container.querySelector('#map-fog').hidden = false;
        apply();
        ctl.focus();
      });
      map.on('error', () => { /* tile hiccups are fine; fallback stays visible until load */ });
      map.on('dragstart', () => { ctl.following = false; onUserMove && onUserMove(); });
      map.on('click', (e) => onTap && onTap({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      // If the style never loads (offline on first run), keep the illustration.
    } catch { map = null; }
  }

  function apply() {
    paintFallback();
    if (!map || !ready) return;
    map.getSource('zone').setData(ctl.zone ? circle(ctl.zone.center, ctl.zone.radius) : EMPTY);
    if (ctl.zone) {
      const el = document.createElement('div');
      el.innerHTML = envMarkerHTML(ctl.zone.n, ctl.zone.label);
      if (envMarker) envMarker.remove();
      envMarker = new gl.Marker({ element: el.firstElementChild, anchor: 'bottom', pitchAlignment: 'viewport' })
        .setLngLat([ctl.zone.center.lng, ctl.zone.center.lat]).addTo(map);
    } else if (envMarker) { envMarker.remove(); envMarker = null; }
    if (ctl.player) {
      if (!meMarker) {
        const el = document.createElement('div'); el.innerHTML = meHTML();
        characters.mountIn(el);
        meMarker = new gl.Marker({ element: el.firstElementChild, anchor: 'bottom', pitchAlignment: 'viewport', offset: [0, 18] });
        meMarker.setLngLat([ctl.player.lng, ctl.player.lat]).addTo(map);
      } else meMarker.setLngLat([ctl.player.lng, ctl.player.lat]);
    } else if (meMarker) { meMarker.remove(); meMarker = null; }
  }

  ctl.setPlayer = (p) => {
    const first = !ctl.player && p;
    ctl.player = p;
    apply();
    if (map && ready && p && ctl.following) map.easeTo({ center: [p.lng, p.lat], duration: first ? 0 : 900 });
  };
  ctl.setZone = (z) => {
    const changed = JSON.stringify(z && [z.center, z.n]) !== JSON.stringify(ctl.zone && [ctl.zone.center, ctl.zone.n]);
    ctl.zone = z;
    apply();
    if (changed && !ctl.player) ctl.focus();
  };
  ctl.focus = () => {
    if (!map || !ready) return;
    const t = ctl.player || (ctl.zone && ctl.zone.center);
    if (t) map.easeTo({ center: [t.lng, t.lat], zoom: 16.4, pitch: 58, duration: 800 });
  };
  ctl.recenter = () => { ctl.following = true; ctl.focus(); };
  ctl.resize = () => map && map.resize();
  ctl.flyTo = (p, zoom = 16.4) => map && ready && map.easeTo({ center: [p.lng, p.lat], zoom, duration: 600 });
  ctl.center = () => (map ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : null);
  ctl.destroy = () => { try { map && map.remove(); } catch {} };
  return ctl;
}
