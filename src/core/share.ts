/**
 * URL-share codec for `.bitwave` documents — pure, DOM-free.
 *
 * A share link is the same JSON project document, UTF-8 encoded and written as
 * unpadded base64url. The fragment is the only transport: it survives
 * `file://`, needs no server and never sends state anywhere.
 *
 * The codec is deliberately dumb: it does not validate the document (the
 * project schema does) and it does not enforce the URL budget. A caller checks
 * `encodeShare(doc).length` against `SHARE_MAX_CHARS` and may drop the dataset
 * before sharing. UTF-8 is hand-rolled so `src/core` keeps compiling with no
 * DOM lib (`TextEncoder` is a browser/Node global type, not ES2022).
 */

import { ProjectError } from "./project.ts";

export const SHARE_PREFIX = "bw=";

/**
 * Budget for the encoded payload, i.e. the characters after `bw=` (no prefix,
 * no leading `#`). A 256-bit document without a dataset is well under this;
 * a full CSV dataset is what can overflow it.
 */
export const SHARE_MAX_CHARS = 2000;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** UTF-8 bytes for a string. JSON.stringify never emits lone surrogates. */
function toUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    // Combine a high/low surrogate pair into one code point.
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

/** Strict UTF-8 decode: invalid/overlong/truncated input is a malformed share. */
function fromUtf8(bytes: Uint8Array): string {
  const fail = (at: number): never => {
    throw new ProjectError("malformed", `share payload is not valid UTF-8 at byte ${at}`);
  };
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i];
    if (lead < 0x80) {
      out += String.fromCharCode(lead);
      i += 1;
      continue;
    }
    let need = 0;
    let cp = 0;
    let min = 0;
    if ((lead & 0xe0) === 0xc0) {
      need = 1;
      cp = lead & 0x1f;
      min = 0x80;
    } else if ((lead & 0xf0) === 0xe0) {
      need = 2;
      cp = lead & 0x0f;
      min = 0x800;
    } else if ((lead & 0xf8) === 0xf0) {
      need = 3;
      cp = lead & 0x07;
      min = 0x10000;
    } else {
      fail(i);
    }
    if (i + need >= bytes.length) fail(i);
    for (let k = 1; k <= need; k++) {
      const next = bytes[i + k];
      if ((next & 0xc0) !== 0x80) fail(i + k);
      cp = (cp << 6) | (next & 0x3f);
    }
    if (cp < min || cp > 0x10ffff) fail(i); // overlong or out of range
    if (cp >= 0xd800 && cp <= 0xdfff) fail(i); // surrogate code point
    i += need + 1;
    if (cp < 0x10000) out += String.fromCharCode(cp);
    else {
      const rest = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (rest >> 10), 0xdc00 + (rest & 0x3ff));
    }
  }
  return out;
}

/** Base64url, no padding: 4 chars per 3 bytes. */
function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (has1) out += ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (has2) out += ALPHABET[b2 & 0x3f];
  }
  return out;
}

/** Reverse of toBase64Url. Throws ProjectError("malformed") on bad input. */
function fromBase64Url(payload: string): Uint8Array {
  if (payload.length % 4 === 1) {
    throw new ProjectError("malformed", "share payload has an impossible base64url length");
  }
  const bytes = new Uint8Array(Math.floor((payload.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < payload.length; i++) {
    const value = ALPHABET.indexOf(payload[i]);
    if (value < 0) {
      throw new ProjectError("malformed", `share payload is not base64url at index ${i}`);
    }
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written++] = (acc >> bits) & 0xff;
    }
  }
  return bytes;
}

/** JSON document -> unpadded base64url payload. */
export function encodeShare(doc: unknown): string {
  const json = JSON.stringify(doc);
  if (typeof json !== "string") {
    throw new ProjectError("malformed", "share document is not JSON-serializable");
  }
  return toBase64Url(toUtf8(json));
}

/** Unpadded base64url payload -> JSON document. Throws ProjectError. */
export function decodeShare(payload: string): unknown {
  const text = fromUtf8(fromBase64Url(payload));
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ProjectError("malformed", "share payload is not JSON");
  }
  return doc;
}

/** `#bw=<payload>` for `history.replaceState`. */
export function shareFragment(doc: unknown): string {
  return "#" + SHARE_PREFIX + encodeShare(doc);
}

/**
 * Read a shared document from a `location.hash`, accepting either the full
 * fragment (`#bw=...`) or the bare payload form (`bw=...`). Returns null when
 * the hash carries no share (empty, a different fragment, or `bw=` with no
 * payload); a present-but-corrupt payload throws ProjectError.
 */
export function parseShareHash(hash: string): unknown | null {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!text.startsWith(SHARE_PREFIX)) return null;
  const payload = text.slice(SHARE_PREFIX.length);
  if (payload === "") return null;
  return decodeShare(payload);
}
