import { letterArt } from './art.js';
let instance = 0;

export function letterDeliveryHTML() {
  return `<div class="letter-delivery" data-letter-delivery data-phase="sealed">
    <button type="button" class="letter-trigger" data-letter-trigger data-act="open-letter" aria-label="Open my birthday letter" aria-expanded="false">
      <span class="letter-delivery-picture">${letterArt('hedwig-' + (++instance))}</span>
      <span class="letter-delivery-label">Open my birthday letter</span>
    </button>
    <p class="sr-only" data-delivery-status role="status" aria-live="polite"></p>
  </div>`;
}

/** The caller owns the private letter. Reveal it only after an uncancelled delivery. */
export function mountLetterDelivery(root, { reducedMotion = () => false, onOpen = () => {} } = {}) {
  const button = root.querySelector('[data-letter-trigger]');
  const status = root.querySelector('[data-delivery-status]');
  const carrier = root.querySelector('.owl-carrier');
  const envelope = root.querySelector('.mail-envelope');
  const animations = new Set(), waits = new Set();
  let dead = false, busy = false, delivered = false;
  const phase = value => { if (!dead) root.dataset.phase = value; };
  function wait(ms) {
    return new Promise(resolve => {
      if (dead) { resolve(false); return; }
      const pending = { timer: 0, resolve };
      pending.timer = setTimeout(() => { waits.delete(pending); resolve(!dead); }, ms);
      waits.add(pending);
    });
  }
  async function animate(el, frames, options) {
    if (dead) return false;
    try {
      const animation = el.animate(frames, { ...options, fill: 'forwards' });
      animations.add(animation);
      await animation.finished; return !dead;
    } catch {
      if (!dead) finish();
      return false;
    }
  }
  function finish() {
    if (dead || delivered || !root.isConnected) return;
    delivered = true; phase('delivered');
    onOpen();
  }
  async function open() {
    if (dead || busy || delivered) return;
    busy = true; button.disabled = true; button.setAttribute('aria-busy', 'true');
    status.textContent = 'Hedwig has a letter for you…';
    try {
      if (reducedMotion() || !envelope.animate) { finish(); return; }
      setTimeout(finish, 5000); // the letter never waits on an animation that stalls
      // One tap on a phone includes the same peek a pointer gets on hover.
      phase('peek');
      if (!await wait(360)) return;
      phase('flying');
      void animate(carrier, [
        { transform: 'translate(0px,0px) rotate(0deg)', opacity: 1, offset: 0 },
        { transform: 'translate(-18px,-44px) rotate(-5deg)', opacity: 1, offset: .34 },
        { transform: 'translate(20px,-76px) rotate(7deg)', opacity: 1, offset: .64 },
        { transform: 'translate(145px,-225px) rotate(12deg) scale(.6)', opacity: 0, offset: 1 },
      ], { duration: 1550, easing: 'ease-in-out' });
      if (!await animate(envelope, [
        { transform: 'translate(0px,0px) rotate(0deg)' },
        { transform: 'translate(-18px,-44px) rotate(-5deg)' },
      ], { duration: 520, easing: 'ease-in-out' })) return;
      phase('drop'); status.textContent = 'Delivered, with love.';
      if (!await animate(envelope, [
        { transform: 'translate(-18px,-44px) rotate(-5deg)', offset: 0 },
        { transform: 'translate(12px,24px) rotate(7deg)', offset: .76 },
        { transform: 'translate(0px,0px) rotate(0deg)', offset: 1 },
      ], { duration: 650, easing: 'cubic-bezier(.3,.1,.6,1)' })) return;
      phase('opening');
      if (!await wait(700)) return;
      finish();
    } catch {
      // A rendering failure must never lock away a requested letter.
      finish();
    }
  }
  return {
    open,
    destroy() {
      if (dead) return; dead = true;
      for (const animation of animations) animation.cancel(); animations.clear();
      for (const pending of waits) { clearTimeout(pending.timer); pending.resolve(false); } waits.clear();
    },
  };
}
