import { createAkhiModel, T } from './model.js';
import { onAvatarChange, state } from './signals.js';
import { createIdleWave } from './idle-wave.js';

const ROOT = new URL('./', import.meta.url);
const mounted = new Set();
let cleanupObserver;

/** A genuine WebGL 3D model inside a transparent, GPS-anchored map marker. */
export function mountAvatar(el, { reducedMotion = false, studio = false } = {}) {
  let dead = false, calm = Boolean(reducedMotion), visible = true, paused = false;
  let frame = null, lastFrame = 0, model = null, renderer = null, scene = null, camera = null, shadow = null, environment = null, lost = false;
  let width = 0, height = 0, forced = null, forcedAt = 0, cueWaveAt = -Infinity, yaw = null, turntable = false;
  let observer = null, resizeObserver = null;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const start = performance.now();
  const idleWave = createIdleWave();
  const host = document.createElement('div'); host.className = 'akhi-avatar';
  host.dataset.state = 'loading'; host.setAttribute('aria-hidden', 'true');
  const poster = new Image(); poster.src = new URL('poster.png', ROOT); poster.alt = ''; poster.draggable = false;
  poster.className = 'akhi-avatar-poster'; host.append(poster); el.append(host);

  const reduced = () => calm || motion.matches;
  function resize() {
    if (!renderer || dead) return;
    const box = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width)), h = Math.max(1, Math.round(box.height));
    if (w === width && h === height) return;
    width = w; height = h; renderer.setSize(w, h, false);
    const extent = studio ? 3.95 : 3.95;
    camera.left = -extent * (w / h) / 2; camera.right = -camera.left;
    camera.top = extent / 2; camera.bottom = -extent / 2; camera.updateProjectionMatrix();
  }
  function render(now) {
    if (!renderer || !model || dead || lost) return;
    resize();
    const t = reduced() ? 0 : (now - start) / 1000;
    const mode = forced || state.motion;
    const running = mode === 'run';
    const walking = mode === 'walk';
    const moving = running || walking;
    const reaction = forced === 'wave' ? (now - forcedAt) / 1000 : now - cueWaveAt < 2300 ? (now - cueWaveAt) / 1000 : state.arrived ? (now - state.arrivalAt) / 1000 : 0;
    const idleAge = idleWave.sample(now, { idle: mode === 'idle' && !turntable, enabled: !reduced() && visible && !paused && !document.hidden, reacting: reaction > 0 && reaction < 2.3 });
    const arrival = reaction > 0 && reaction < 2.3 ? reaction : idleAge;
    host.dataset.wave = idleAge > 0 ? 'idle' : reaction > 0 && reaction < 2.3 ? 'reaction' : '';
    // Always face slightly toward her viewer at rest; turn naturally while actually moving.
    const direction = Math.atan2(1.8, 8.5) + Math.PI - state.heading + state.bearing;
    const facing = yaw != null ? yaw : moving && !forced ? direction : .06 + Math.sin(t * .35) * .10;
    const desired = turntable && !reduced() ? t * .4 : facing;
    let delta = desired - model.root.rotation.y; delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const smoothYaw = reduced() ? desired : model.root.rotation.y + delta * .12;
    model.pose(t, { walking, running, arrival, calm: reduced(), yaw: smoothYaw });
    host.dataset.state = reduced() ? 'calm' : arrival > 0 && arrival < 2.3 ? 'wave' : running ? 'running' : walking ? 'walking' : 'idle';
    host.dataset.arrived = String(state.arrived);
    renderer.render(scene, camera);
  }
  function stopLoop() { if (frame != null) cancelAnimationFrame(frame); frame = null; }
  function tick(now) {
    frame = null;
    if (dead || paused || !visible || document.hidden || !renderer) return;
    if (!el.isConnected) { destroy(); return; }
    const active = host.dataset.state === 'wave' || turntable || forced === 'walk' || forced === 'run' || now - cueWaveAt < 2300 || (forced === 'wave' && now - forcedAt < 2300) || now < state.walkingUntil || (state.arrived && now - state.arrivalAt < 2300);
    if (now - lastFrame >= 1000 / (active ? 30 : 12)) { lastFrame = now; render(now); }
    if (!reduced()) frame = requestAnimationFrame(tick);
  }
  function wake() {
    if (dead || !renderer || lost) return;
    if (paused || !visible || document.hidden) { stopLoop(); return; }
    render(performance.now());
    if (!reduced() && frame == null) frame = requestAnimationFrame(tick);
    else if (reduced()) stopLoop();
  }
  function build() {
    if (dead || renderer || !visible || document.hidden) return;
    try {
      renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.VSMShadowMap;
      renderer.domElement.className = 'akhi-avatar-canvas'; renderer.domElement.setAttribute('aria-hidden', 'true');
      scene = new T.Scene(); camera = new T.OrthographicCamera(-2, 2, 2, -2, .1, 50);
      camera.position.set(1.8, 2.6, 8.5); camera.lookAt(0, 1.67, 0);
      // Broad reflected softboxes and restrained warm/cool fill give the doll a soft vinyl finish.
      const ec = document.createElement('canvas'); ec.width = 512; ec.height = 256;
      const ex = ec.getContext('2d'); ex.fillStyle = '#95929c'; ex.fillRect(0, 0, 512, 256);
      for (const [px,py,r,color] of [[140,85,135,'rgba(255,247,233,1)'],[380,100,100,'rgba(231,220,250,.9)'],[260,20,100,'rgba(255,255,255,.8)']]) {
        const gradient = ex.createRadialGradient(px,py,0,px,py,r); gradient.addColorStop(0,color); gradient.addColorStop(1,'rgba(255,255,255,0)'); ex.fillStyle=gradient;ex.fillRect(0,0,512,256);
      }
      const et = new T.CanvasTexture(ec); et.colorSpace = T.SRGBColorSpace; et.mapping = T.EquirectangularReflectionMapping;
      const pmrem = new T.PMREMGenerator(renderer); environment = pmrem.fromEquirectangular(et); scene.environment=environment.texture;scene.environmentIntensity=.24;et.dispose();pmrem.dispose();
      scene.add(new T.HemisphereLight(0xfff2ed, 0x9999b1, .7));
      const key = new T.DirectionalLight(0xfff2e7, 3.0); key.position.set(-3, 5, 5); key.target.position.set(0,1.7,0); scene.add(key.target); key.castShadow=true; key.shadow.mapSize.set(512,512);key.shadow.camera.left=-2.2;key.shadow.camera.right=2.2;key.shadow.camera.top=2.2;key.shadow.camera.bottom=-2.2;key.shadow.camera.near=.5;key.shadow.camera.far=15;key.shadow.radius=5;key.shadow.blurSamples=8;key.shadow.bias=-.0001;key.shadow.normalBias=.018;scene.add(key);
      const fill = new T.DirectionalLight(0xdedcf9, .35); fill.position.set(4, 2, 4); scene.add(fill);
      const rim = new T.DirectionalLight(0xf5d8ec, 1.35); rim.position.set(2, 4, -4); scene.add(rim);
      model = createAkhiModel(); scene.add(model.root);
      const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
      const x = shadowCanvas.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 31);
      g.addColorStop(0, 'rgba(57,43,28,.26)'); g.addColorStop(.55, 'rgba(57,43,28,.10)'); g.addColorStop(1, 'rgba(57,43,28,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      shadow = new T.Mesh(new T.PlaneGeometry(1.5, 1.15), new T.MeshBasicMaterial({ map: new T.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.025; scene.add(shadow);
      host.append(renderer.domElement); resize(); render(performance.now()); host.dataset.ready = 'true';
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
      poster.hidden = true; wake();
    } catch {
      host.dataset.state = 'fallback'; host.dataset.ready = 'fallback';
      try { model?.dispose(); renderer?.dispose(); environment?.dispose(); } catch {}
      renderer?.domElement.remove(); renderer = null; model = null; poster.hidden = false;
    }
  }
  function contextLost(e) { idleWave.reset(); e.preventDefault(); lost = true; stopLoop(); poster.hidden = false; host.dataset.state = 'fallback'; }
  function contextRestored() { lost = false; poster.hidden = true; wake(); }
  function preference() { idleWave.reset(); stopLoop(); wake(); }
  function visibility() { if (document.hidden) { idleWave.reset(); stopLoop(); } else { paused = false; if (!renderer) build(); wake(); } }
  const unsubscribe = onAvatarChange(() => { if (!renderer) build(); wake(); });
  if (motion.addEventListener) motion.addEventListener('change', preference); else motion.addListener(preference);
  document.addEventListener('visibilitychange', visibility);
  if ('ResizeObserver' in window) { resizeObserver = new ResizeObserver(() => wake()); resizeObserver.observe(host); }
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      visible = entries.some(e => e.isIntersecting); if (!visible) idleWave.reset(); if (visible && !renderer) build(); wake();
    }); observer.observe(host);
  }
  const ctl = {
    el,
    setReducedMotion(value) { calm = Boolean(value); preference(); },
    setCue(cue) { if (cue === 'success' || cue === 'enter') { cueWaveAt = performance.now(); paused = false; wake(); } },
    pause() { paused = true; idleWave.reset(); stopLoop(); },
    // Preview controls; the hunt itself uses map signals, never studio overrides.
    setMode(mode) { idleWave.reset(); forced = mode === 'auto' ? null : mode; forcedAt = performance.now(); paused = false; wake(); },
    setYaw(value) { yaw = value; wake(); },
    setTurntable(value) { turntable = Boolean(value); wake(); },
    snapshot() { render(performance.now()); return renderer?.domElement.toDataURL('image/png') || null; },
    stats() { return { ready: Boolean(renderer), mode: host.dataset.state, frames: renderer?.info.render.frame || 0, triangles: renderer?.info.render.triangles || 0, calls: renderer?.info.render.calls || 0 }; },
    destroy,
  };
  function destroy() {
    if (dead) return; dead = true; idleWave.reset(); stopLoop(); observer?.disconnect(); resizeObserver?.disconnect(); unsubscribe();
    document.removeEventListener('visibilitychange', visibility);
    if (motion.removeEventListener) motion.removeEventListener('change', preference); else motion.removeListener(preference);
    if (renderer) {
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
      model?.dispose(); shadow?.geometry.dispose(); shadow?.material.map.dispose(); shadow?.material.dispose();
      scene?.traverse(o=>{if(o.isLight&&o.shadow)o.shadow.dispose();}); environment?.dispose(); renderer.dispose(); renderer.forceContextLoss();
    }
    host.remove(); mounted.delete(ctl);
    if (!mounted.size) { cleanupObserver?.disconnect(); cleanupObserver = null; }
  }
  mounted.add(ctl);
  if (!cleanupObserver) {
    cleanupObserver = new MutationObserver(() => {
      for (const instance of [...mounted]) if (!instance.el.isConnected) instance.destroy();
    }); cleanupObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  // Let a MapLibre marker enter the document before the first rendering work.
  queueMicrotask(() => { if (!dead && el.isConnected) build(); });
  return ctl;
}
