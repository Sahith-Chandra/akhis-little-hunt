// The letter ships encrypted. Only the right 4-digit code can decrypt it; the code itself is never stored here.
const decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Returns { heading, body, signoff }, or null if the code is wrong. */
export async function unsealLetter(sealed, pin) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: decode(sealed.salt), iterations: sealed.iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(sealed.iv) }, key, decode(sealed.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch { return null; }
}
