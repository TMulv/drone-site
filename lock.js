// Password-locked 360s. The pano and thumb are stored encrypted (AES-GCM, key from PBKDF2-SHA256),
// so the files on the site are unreadable without the password, even to someone poking around GitHub.
// File format: 12-byte IV, then the AES-GCM ciphertext (which ends in a 16-byte auth tag).
// Shared by script.js (unlock) and upload.js (lock on publish). Works in Node 20+ too (globalThis.crypto).
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export const ITERATIONS = 600000;

export function newLock() {
  return { kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: b64(crypto.getRandomValues(new Uint8Array(16))) };
}

export async function deriveKey(password, lock) {
  const base = await subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(lock.salt), iterations: lock.iter || ITERATIONS },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}

// throws on a wrong password (the auth tag won't match)
export async function decryptBytes(key, bytes) {
  const buf = new Uint8Array(bytes);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12) }, key, buf.subarray(12)));
}

export async function fetchDecrypted(url, key, type = 'image/jpeg') {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`couldn't load ${url}`);
  const plain = await decryptBytes(key, await r.arrayBuffer());
  return URL.createObjectURL(new Blob([plain], { type }));
}
