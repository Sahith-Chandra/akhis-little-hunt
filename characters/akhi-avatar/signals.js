// In-memory map-to-avatar motion only. No DOM, rendering dependency, or location storage.
// A separate detector lets GPS sequences be checked with a deterministic clock.
export function createAvatarMotion({ now = () => performance.now() } = {}) {
  const listeners = new Set();
  let previous = null, anchor = null, fastFixes = 0;
  const state = {
    walkingUntil: 0, runningUntil: 0, speedMps: 0,
    heading: 0, bearing: 0, arrived: false, arrivalAt: -Infinity,
    get motion() { return now() < this.walkingUntil ? now() < this.runningUntil ? 'run' : 'walk' : 'idle'; },
  };
  const emit = () => listeners.forEach(fn => fn(state));
  const number = value => typeof value === 'number' && Number.isFinite(value);
  const displacement = (a, b) => {
    const dy = (b.lat - a.lat) * 111320;
    // Take the short route across the antimeridian as well.
    const dlng = ((b.lng - a.lng + 540) % 360) - 180;
    const dx = dlng * 111320 * Math.cos(b.lat * Math.PI / 180);
    return { dx, dy, meters: Math.hypot(dx, dy) };
  };
  const secondsBetween = (a, b) => (a.timestamp != null && b.timestamp != null ? b.timestamp - a.timestamp : b.at - a.at) / 1000;
  function stop() { state.walkingUntil = state.runningUntil = state.speedMps = 0; fastFixes = 0; }
  function animate(speed, seconds, reported) {
    const running = state.motion === 'run';
    if (speed >= 2.5) fastFixes++; else fastFixes = 0;
    const run = reported ? speed >= (running ? 1.8 : 2.5) : running ? speed >= 1.8 : fastFixes >= 2;
    const hold = Math.max(3000, Math.min(10000, seconds * 1600 + 300));
    state.walkingUntil = now() + hold;
    state.runningUntil = run ? state.walkingUntil : 0;
    state.speedMps = speed;
  }
  function setLocation(p) {
    if (!p || !number(p.lat) || !number(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) {
      previous = anchor = null; stop(); emit(); return;
    }
    const at = now();
    const sample = { lat: p.lat, lng: p.lng, at, timestamp: number(p.timestamp) ? p.timestamp : null };
    // Cached/duplicate fixes must not make a stationary avatar keep walking.
    if (previous && (at <= previous.at || (sample.timestamp != null && previous.timestamp != null && sample.timestamp <= previous.timestamp))) return;
    const seconds = previous ? secondsBetween(previous, sample) : 1;
    const step = previous ? displacement(previous, sample) : null;
    // Reject a location jump, not a legitimate >80 m drive between sparse GPS fixes.
    if (previous && (seconds <= 0 || seconds > 15 || at - previous.at > 15000 || step.meters / seconds > 70)) {
      previous = anchor = sample; stop(); emit(); return;
    }
    const speed = number(p.speed) && p.speed >= 0 && p.speed <= 70 && (!number(p.accuracy) || p.accuracy <= 100) ? p.speed : null;
    const total = anchor ? displacement(anchor, sample) : null;
    const moved = total && total.meters >= .4;
    if (speed != null && speed >= .12) {
      animate(speed, seconds, true);
    } else if (moved) {
      // Accumulate NET movement, not a sum of jitter or a reset on every tiny fix.
      const elapsed = Math.max(.001, secondsBetween(anchor, sample));
      animate(total.meters / elapsed, seconds, false);
    } else if (state.motion === 'idle') {
      state.speedMps = 0; fastFixes = 0;
    }
    if (state.motion !== 'idle') {
      if (number(p.heading) && p.heading >= 0 && p.heading < 360 && speed != null && speed >= .12) state.heading = p.heading * Math.PI / 180;
      else if (moved) state.heading = Math.atan2(total.dx, total.dy);
    }
    if (!anchor || moved) anchor = sample;
    previous = sample;
    emit();
  }
  function setArrival(value) {
    value = Boolean(value);
    if (value === state.arrived) return;
    state.arrived = value; if (value) state.arrivalAt = now(); emit();
  }
  function setBearing(degrees) { if (number(degrees)) { state.bearing = degrees * Math.PI / 180; emit(); } }
  function onChange(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }
  return { state, setLocation, setArrival, setBearing, onChange };
}
const avatar = createAvatarMotion();
export const state = avatar.state;
export const onAvatarChange = avatar.onChange;
export const setAvatarLocation = avatar.setLocation;
export const setAvatarArrival = avatar.setArrival;
export const setAvatarBearing = avatar.setBearing;
