// Sampled by the avatar renderer: no timers, DOM work, or location data.
export function createIdleWave({ random = Math.random } = {}) {
  let lastAt = null, dueAt = null, startedAt = null;
  const delay = () => {
    const value = random();
    return 12000 + Math.max(0, Math.min(1, Number.isFinite(value) ? value : .5)) * 8000;
  };
  function reset() { lastAt = dueAt = startedAt = null; }
  function sample(nowMs, { idle = true, enabled = true, reacting = false } = {}) {
    if (!Number.isFinite(nowMs) || !idle || !enabled || reacting) { reset(); return 0; }
    // A hidden/suspended renderer waits again after returning; it never catches up.
    if (lastAt != null && (nowMs - lastAt > 1500 || nowMs < lastAt)) reset();
    lastAt = nowMs;
    if (startedAt != null) {
      const elapsed = nowMs - startedAt;
      if (elapsed < 2300) return Math.max(.001, elapsed / 1000);
      startedAt = null;
      dueAt = nowMs + delay();
      return 0;
    }
    if (dueAt == null) { dueAt = nowMs + delay(); return 0; }
    if (nowMs >= dueAt) { startedAt = nowMs; dueAt = null; return .001; }
    return 0;
  }
  return { sample, reset };
}
