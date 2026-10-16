// SPDX-License-Identifier: AGPL-3.0-or-later
// WebView + Node: no Node API, hardware identifier or weak-random fallback.
import { md5 as digest } from '@noble/hashes/legacy.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
export const md5 = text => bytesToHex(digest(utf8ToBytes(text)));
export function randomInt(min, max) {
  if (max === undefined) { max = min; min = 0; }
  const span = max - min;
  const limit = Math.floor(0x100000000 / span) * span;
  const value = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(value); } while (value[0] >= limit);
  return min + value[0] % span;
}
export function uuid() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytesToHex(bytes).toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
