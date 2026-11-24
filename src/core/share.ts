/**
 * URL-share codec for `.bitwave` documents — pure, DOM-free.
 *
 * Two payload forms share one envelope (`#bw=<unpadded base64url>`):
 *
 *   1. **Legacy JSON** (written by builds up to toolset 1.2.0): the whole
 *      `.bitwave` document, UTF-8 encoded. Still decoded and upgraded on read
 *      (schema 1–4, D44), and `encodeShare` keeps writing it so old fixtures
 *      and cross-build links stay readable.
 *   2. **Compact** (canonical since toolset 1.3.0, D45): a JSON array with a
 *      leading codec tag (`PROJECT_SCHEMA`), lane tuples with documented
 *      defaults omitted and register words as raw-bit base64url. This is what
 *      `buildShareLink` (the address bar, `getDeeplink()` and
 *      `build_deeplink`) writes. See `docs/AGENT-INTERFACE.md` §5 and
 *      `DECISIONS.md` D45 for the layout.
 *
 * `decodeShare` returns the raw JSON value; `decodeShareDocument` inspects it
 * (array = compact, object = legacy) and expands a compact payload back to a
 * canonical-shaped schema-4 document, which `deserializeProject` validates and
 * upgrades. `parseShareHash` is that front door.
 *
 * The codec is deliberately dumb: it does not validate the document (the
 * project schema does) and it does not enforce the URL budget. A caller checks
 * the payload length against `SHARE_MAX_CHARS` and may drop the dataset and/or
 * expressions before sharing. UTF-8 is hand-rolled so `src/core` keeps
 * compiling with no DOM lib (`TextEncoder` is a browser/Node global type, not
 * ES2022).
 */

import {
  PROJECT_APP,
  PROJECT_BINOPS,
  PROJECT_MIXES,
  PROJECT_SCHEMA,
  ProjectError,
  type ProjectDoc,
  type ProjectFreeFrame,
  type ProjectLane,
  type ProjectRoute,
  type ProjectViewState,
} from "./project.ts";
import { APP_FREE_FRAME_CAP, freeFrameKeyFromName } from "./lanedefs.ts";
import { fromHex, toHex } from "./registers.ts";
import type { BinOp, FrameKey, FreeFrameKey, LaneKey, MixOp } from "./types.ts";

export const SHARE_PREFIX = "bw=";

/**
 * Budget for the encoded payload, i.e. the characters after `bw=` (no prefix,
 * no leading `#`). The compact codec keeps an 8-lane 256-bit document under
 * this (D45); a large CSV dataset or many expression sources is what can
 * overflow it, and then the dataset (first) and expressions are dropped with
 * explicit flags.
 */
export const SHARE_MAX_CHARS = 2000;

/**
 * Top-level `.bitwave` keys understood by this build. Everything else rides
 * through a canonical document and a compact link (D44) under the `x` slot.
 */
export const SHARE_DOC_KEYS: ReadonlySet<string> = new Set([
  "schema", "app", "savedAt", "N", "view", "lanes", "frames", "routes", "parked", "dataset",
]);

/**
 * Leading tag of a compact payload. It is the `.bitwave` schema the compact
 * array expands to, so a future schema bump gets a new tag for free; a tag
 * newer than this build is refused as `newer-schema` exactly like a legacy
 * document (never half-applied).
 */
export const COMPACT_SHARE_TAG = PROJECT_SCHEMA;

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

/**
 * `#bw=<payload>` for the **legacy JSON** form of `doc`. Canonical links are
 * built by `buildShareLink` (`agent-share.ts`), which writes the compact codec;
 * this helper stays as the raw-envelope encoder that acceptance tests and
 * cross-build fixtures use.
 */
export function shareFragment(doc: unknown): string {
  return "#" + SHARE_PREFIX + encodeShare(doc);
}

// ---------------------------------------------------------------------------
// Compact payload (D45) — the canonical writer
// ---------------------------------------------------------------------------
//
//   [ tag, N, view, lanes, routes, parked, dataset?, x? ]
//
// tag     = PROJECT_SCHEMA (4); a newer tag is refused as `newer-schema`
// N       = register width
// view    = [lane, flags, pairLane, pairLane, activePane, lfoMode?, lfoRate?]
//           flags = view3d | split3d<<1; LFO defaults (rotcw/4) omitted
// lanes   = ascending lane-key order, each
//           [key, a, b, showB, binop, edit, seededB, lfoB, colA, colB,
//            focus?, frameVis?, expressions?]
//           a/b are unpadded base64url of the raw N/8 bytes of the word (the
//           canonical hex read left-to-right, two hex digits per byte); the
//           trailing fields are omitted when all of them are at their defaults
//           (focus "a", frameVis visible, no expressions). frameVis is a mask
//           (1 = A hidden, 2 = B hidden, 4 = Z hidden). expressions is
//           [aText?] or [aText?, bText?] with `null` for an absent A.
// routes  = ascending destination order, each
//           [fromLane, fromFrame, toLane, toFrame, mix]; delay is recomputed
// parked  = ascending port order, each [lane, frame, base] (same word encoding)
// dataset = [cols, rows] or [cols, rows, index]
// x       = unknown top-level document fields, preserved verbatim (D44)
//
// Everything here is deterministic: equal engine state produces equal arrays.

const FRAME_ORDER: readonly FrameKey[] = ["a", "b", "z"];
const BINOP_ORDER: readonly BinOp[] = PROJECT_BINOPS;
const MIX_ORDER: readonly MixOp[] = PROJECT_MIXES;
const DEFAULT_LFO_MODE = "rotcw";
const DEFAULT_LFO_RATE = 4;
/** frameVis mask bits: 1 = A hidden, 2 = B hidden, 4 = Z hidden. */
const HIDDEN_A = 1;
const HIDDEN_B = 2;
const HIDDEN_Z = 4;

function malformed(message: string): never {
  throw new ProjectError("malformed", message);
}

/** Canonical hex word -> unpadded base64url of its raw bytes (two hex digits each). */
function compactRegister(hex: string, N: number): string {
  const canonical = toHex(fromHex(hex, N), N);
  const bytes = new Uint8Array(N / 8);
  for (let k = 0; k < bytes.length; k++) {
    bytes[k] = parseInt(canonical.slice(2 * k, 2 * k + 2), 16);
  }
  return toBase64Url(bytes);
}

/** Unpadded base64url of a raw word -> canonical uppercase hex; wrong length is malformed. */
function expandRegister(text: unknown, N: number, where: string): string {
  if (typeof text !== "string") malformed(`${where} must be a compact register string`);
  const bytes = fromBase64Url(text);
  if (bytes.length !== N / 8) {
    malformed(`${where} holds ${bytes.length} bytes; ${N} bits need ${N / 8}`);
  }
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex.toUpperCase();
}

/** Encode a port string ("1.a" or "F2") as [laneOrNegFree, frameIdx]. */
function encodeCompactPort(port: string, where: string): [number, number] {
  const freeKey = freeFrameKeyFromName(port);
  if (freeKey !== null) return [-Number(freeKey), 0];
  const dot = port.indexOf(".");
  if (dot < 0) malformed(`${where} has an invalid port`);
  const lane = Number(port.slice(0, dot));
  if (!Number.isInteger(lane) || lane < 1 || lane > 13) malformed(`${where} has an invalid lane`);
  const frame = FRAME_ORDER.indexOf(port.slice(dot + 1) as FrameKey);
  if (frame < 0) malformed(`${where} has an invalid frame`);
  return [lane, frame];
}

function compareEncodedPorts(a: readonly [number, number], b: readonly [number, number]): number {
  const aIsFree = a[0] < 0 ? 1 : 0;
  const bIsFree = b[0] < 0 ? 1 : 0;
  if (aIsFree !== bIsFree) return aIsFree - bIsFree;
  const aKey = aIsFree ? -a[0] : a[0];
  const bKey = bIsFree ? -b[0] : b[0];
  return aKey - bKey || a[1] - b[1];
}

function encodeEnum<T extends string>(order: readonly T[], value: T, where: string): number {
  const index = order.indexOf(value);
  if (index < 0) malformed(`${where} has an unknown value`);
  return index;
}

function encodeCompactView(view: ProjectViewState): unknown[] {
  const tuple: unknown[] = [
    Number(view.lane),
    (view.view3d ? 1 : 0) | (view.split3d ? 2 : 0),
    Number(view.splitPair[0]),
    Number(view.splitPair[1]),
    view.activePane === 1 ? 1 : 0,
  ];
  const mode = view.lfoMode ?? DEFAULT_LFO_MODE;
  const rate = view.lfoRate ?? DEFAULT_LFO_RATE;
  const activeFree = typeof view.activeFree === "string" && view.activeFree !== "" ? Number(view.activeFree) : null;
  if (mode !== DEFAULT_LFO_MODE || rate !== DEFAULT_LFO_RATE || activeFree !== null) {
    tuple.push(mode);
    if (rate !== DEFAULT_LFO_RATE || activeFree !== null) {
      tuple.push(rate);
      if (activeFree !== null) tuple.push(activeFree);
    }
  }
  return tuple;
}

function encodeCompactFreeFrame(key: FreeFrameKey, ff: ProjectFreeFrame, N: number): unknown[] {
  const tuple: unknown[] = [Number(key), compactRegister(ff.hex, N)];
  const col = typeof ff.col === "number" && Number.isInteger(ff.col) ? ff.col : -1;
  const vis = ff.visible === false ? 0 : 1;
  const expr = typeof ff.expression === "string" ? ff.expression : "";
  const label = typeof ff.label === "string" ? ff.label : "";
  const note = typeof ff.sourceNote === "string" ? ff.sourceNote : "";
  if (col !== -1 || vis !== 1 || expr !== "" || label !== "" || note !== "") {
    tuple.push(col);
    if (vis !== 1 || expr !== "" || label !== "" || note !== "") {
      tuple.push(vis);
      if (expr !== "" || label !== "" || note !== "") {
        tuple.push(expr);
        if (label !== "" || note !== "") {
          tuple.push(label);
          if (note !== "") tuple.push(note);
        }
      }
    }
  }
  return tuple;
}

function encodeCompactLane(key: LaneKey, lane: ProjectLane, N: number): unknown[] {
  const tuple: unknown[] = [
    Number(key),
    compactRegister(lane.a, N),
    compactRegister(lane.b, N),
    lane.showB ? 1 : 0,
    encodeEnum(BINOP_ORDER, lane.binop, `lanes.${key}.binop`),
    lane.edit === "b" ? 1 : 0,
    lane.seededB ? 1 : 0,
    lane.lfoB,
    lane.colA,
    lane.colB,
  ];
  const focus = lane.focus ?? "a";
  const vis = lane.frameVis ?? { a: true, b: true, z: true };
  const visMask =
    (vis.a === false ? HIDDEN_A : 0) | (vis.b === false ? HIDDEN_B : 0) | (vis.z === false ? HIDDEN_Z : 0);
  const expressions = lane.expressions ?? {};
  const textA = typeof expressions.a === "string" && expressions.a !== "" ? expressions.a : null;
  const textB = typeof expressions.b === "string" && expressions.b !== "" ? expressions.b : null;
  const hasExpressions = textA !== null || textB !== null;
  if (focus !== "a" || visMask !== 0 || hasExpressions) {
    tuple.push(FRAME_ORDER.indexOf(focus));
    if (visMask !== 0 || hasExpressions) {
      tuple.push(visMask);
      if (hasExpressions) {
        tuple.push(textA);
        if (textB !== null) tuple.push(textB);
      }
    }
  }
  return tuple;
}

/** Destination-first ordering: destinations are unique, so this is total. */
function compareRoutePorts(a: ProjectRoute, b: ProjectRoute): number {
  const fromA = encodeCompactPort(a.from, "route.from");
  const fromB = encodeCompactPort(b.from, "route.from");
  const toA = encodeCompactPort(a.to, "route.to");
  const toB = encodeCompactPort(b.to, "route.to");
  return compareEncodedPorts(toA, toB) || compareEncodedPorts(fromA, fromB);
}

/**
 * Serialize a **canonical** `.bitwave` document (`canonicalShareDocument`) to
 * the compact base64url payload. Unknown top-level fields ride under `x`.
 */
export function encodeCompactShare(doc: ProjectDoc): string {
  if (typeof doc !== "object" || doc === null || typeof doc.N !== "number") {
    malformed("compact share needs a project document");
  }
  const N = doc.N;
  if (!Number.isInteger(N) || N < 8 || N > 256 || N % 8 !== 0) {
    malformed(`compact share has an unsupported width: ${String(N)}`);
  }
  if (typeof doc.lanes !== "object" || doc.lanes === null) malformed("compact share needs lanes");
  const laneKeys = Object.keys(doc.lanes).sort((a, b) => Number(a) - Number(b));
  if (laneKeys.length === 0) malformed("compact share needs at least one lane");
  const lanes = laneKeys.map((key) => encodeCompactLane(key, doc.lanes[key], N));

  const routes = doc.routes
    .slice()
    .sort(compareRoutePorts)
    .map((route) => {
      const [fromKey, fromFrame] = encodeCompactPort(route.from, "route.from");
      const [toKey, toFrame] = encodeCompactPort(route.to, "route.to");
      return [fromKey, fromFrame, toKey, toFrame, encodeEnum(MIX_ORDER, route.mix, "route.mix")];
    });

  const parked = Object.keys(doc.parked)
    .map((port) => {
      const encoded = encodeCompactPort(port, "parked port");
      return [encoded[0], encoded[1], port] as const;
    })
    .sort((a, b) => compareEncodedPorts([a[0], a[1]], [b[0], b[1]]))
    .map(([key, frame, port]) => [key, frame, compactRegister(doc.parked[port], N)]);

  const payload: unknown[] = [
    COMPACT_SHARE_TAG,
    N,
    encodeCompactView(doc.view),
    lanes,
    routes,
    parked,
  ];

  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!SHARE_DOC_KEYS.has(key)) extras[key] = value;
  }
  const hasExtras = Object.keys(extras).length > 0;
  const freeKeys = doc.frames ? Object.keys(doc.frames).sort((a, b) => Number(a) - Number(b)) : [];
  const hasFrames = freeKeys.length > 0;

  if (doc.dataset) {
    const dataset: unknown[] = [doc.dataset.cols, doc.dataset.rows];
    if (Object.prototype.hasOwnProperty.call(doc.dataset, "index")) dataset.push(doc.dataset.index);
    payload.push(dataset);
  } else if (hasExtras || hasFrames) {
    payload.push(null); // dataset slot
  }
  if (hasExtras) {
    payload.push(extras);
  } else if (hasFrames) {
    payload.push(null); // extras slot
  }
  if (hasFrames && doc.frames) {
    payload.push(freeKeys.map((key) => encodeCompactFreeFrame(key, doc.frames![key], N)));
  }

  return toBase64Url(toUtf8(JSON.stringify(payload)));
}

// ---------------------------------------------------------------------------
// Compact payload decoding
// ---------------------------------------------------------------------------

const isObjectValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function decodeFlag(value: unknown, where: string): boolean {
  if (value === 0) return false;
  if (value === 1) return true;
  return malformed(`${where} must be 0 or 1`);
}

function decodeLaneNumber(value: unknown, where: string): LaneKey {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 13) {
    malformed(`${where} must be a lane number in [1, 13]`);
  }
  return String(value);
}

function decodeFrameIndex(value: unknown, where: string): FrameKey {
  if (value !== 0 && value !== 1 && value !== 2) malformed(`${where} must be a frame index in [0, 2]`);
  return FRAME_ORDER[value];
}

function decodeCompactPort(rawKey: unknown, rawFrame: unknown, tag: number, where: string): string {
  if (typeof rawKey === "number" && Number.isInteger(rawKey) && rawKey < 0) {
    if (tag < 5) malformed(`${where} free-frame port requires compact share tag 5`);
    const freeNum = -rawKey;
    if (freeNum < 1 || freeNum > APP_FREE_FRAME_CAP || rawFrame !== 0) {
      malformed(`${where} has an invalid free-frame port`);
    }
    return `F${freeNum}`;
  }
  return `${decodeLaneNumber(rawKey, where)}.${decodeFrameIndex(rawFrame, where)}`;
}

function decodeCompactView(value: unknown, tag: number): ProjectViewState {
  if (!Array.isArray(value) || value.length < 5) malformed("compact view must be a 5-field tuple");
  if (!Number.isInteger(value[1]) || value[1] < 0 || value[1] > 3) malformed("compact view flags must be in [0, 3]");
  const view: ProjectViewState = {
    lane: decodeLaneNumber(value[0], "compact view lane"),
    view3d: (value[1] & 1) === 1,
    split3d: (value[1] & 2) === 2,
    splitPair: [
      decodeLaneNumber(value[2], "compact view splitPair"),
      decodeLaneNumber(value[3], "compact view splitPair"),
    ],
    activePane: value[4] === 1 ? 1 : 0,
  };
  if (value[4] !== 0 && value[4] !== 1) malformed("compact view activePane must be 0 or 1");
  if (value.length > 5) {
    if (typeof value[5] !== "string") malformed("compact view lfoMode must be a string");
    view.lfoMode = value[5];
  } else {
    view.lfoMode = DEFAULT_LFO_MODE;
  }
  if (value.length > 6) {
    if (typeof value[6] !== "number" || !Number.isFinite(value[6]) || value[6] <= 0) {
      malformed("compact view lfoRate must be a positive number");
    }
    view.lfoRate = value[6];
  } else {
    view.lfoRate = DEFAULT_LFO_RATE;
  }
  if (value.length > 7) {
    if (tag < 5 || value.length > 8) malformed("compact view has unexpected trailing fields");
    const af = value[7];
    if (!Number.isInteger(af) || (af as number) < 1 || (af as number) > APP_FREE_FRAME_CAP) {
      malformed("compact view activeFree must be a free-frame number");
    }
    view.activeFree = String(af);
  }
  return view;
}

function decodeCompactFreeFrame(value: unknown, N: number): [FreeFrameKey, ProjectFreeFrame] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 7) {
    malformed("compact free frame must be a 2..7-field tuple");
  }
  const keyNum = value[0];
  if (!Number.isInteger(keyNum) || (keyNum as number) < 1 || (keyNum as number) > APP_FREE_FRAME_CAP) {
    malformed(`compact free frame key must be in [1, ${APP_FREE_FRAME_CAP}]`);
  }
  const key = String(keyNum);
  const ff: ProjectFreeFrame = { hex: expandRegister(value[1], N, `compact frame F${key}.hex`) };
  if (value.length > 2) {
    if (!Number.isInteger(value[2]) || (value[2] as number) < -1) {
      malformed(`compact frame F${key}.col must be an integer >= -1`);
    }
    if ((value[2] as number) >= 0) ff.col = value[2] as number;
  }
  if (value.length > 3) {
    if (!decodeFlag(value[3], `compact frame F${key}.visible`)) ff.visible = false;
  }
  if (value.length > 4) {
    if (typeof value[4] !== "string") malformed(`compact frame F${key}.expression must be a string`);
    if (value[4] !== "") ff.expression = value[4];
  }
  if (value.length > 5) {
    if (typeof value[5] !== "string") malformed(`compact frame F${key}.label must be a string`);
    if (value[5] !== "") ff.label = value[5];
  }
  if (value.length > 6) {
    if (typeof value[6] !== "string") malformed(`compact frame F${key}.sourceNote must be a string`);
    if (value[6] !== "") ff.sourceNote = value[6];
  }
  return [key, ff];
}

function decodeCompactLane(value: unknown, N: number): [LaneKey, ProjectLane] {
  if (!Array.isArray(value) || value.length < 10) malformed("compact lane must be a 10-field tuple");
  if (value.length > 14) malformed("compact lane has unexpected trailing fields");
  const key = decodeLaneNumber(value[0], "compact lane key");
  const binop = BINOP_ORDER[value[4] as number];
  if (value[4] !== 0 && value[4] !== 1 && value[4] !== 2 && value[4] !== 3 && value[4] !== 4) {
    malformed(`compact lane ${key}.binop must be an operator index in [0, 4]`);
  }
  if (typeof value[7] !== "string") malformed(`compact lane ${key}.lfoB must be a string`);
  if (!Number.isInteger(value[8]) || !Number.isInteger(value[9])) {
    malformed(`compact lane ${key} columns must be integers`);
  }
  const lane: ProjectLane = {
    a: expandRegister(value[1], N, `compact lane ${key}.a`),
    b: expandRegister(value[2], N, `compact lane ${key}.b`),
    showB: decodeFlag(value[3], `compact lane ${key}.showB`),
    binop,
    edit: decodeFlag(value[5], `compact lane ${key}.edit`) ? "b" : "a",
    seededB: decodeFlag(value[6], `compact lane ${key}.seededB`),
    lfoB: value[7],
    colA: value[8] as number,
    colB: value[9] as number,
    focus: "a",
    frameVis: { a: true, b: true, z: true },
  };
  if (value.length > 10) lane.focus = decodeFrameIndex(value[10], `compact lane ${key}.focus`);
  if (value.length > 11) {
    const mask = value[11];
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) malformed(`compact lane ${key}.frameVis must be in [0, 7]`);
    lane.frameVis = {
      a: (mask & HIDDEN_A) === 0,
      b: (mask & HIDDEN_B) === 0,
      z: (mask & HIDDEN_Z) === 0,
    };
  }
  if (value.length > 12) {
    const textA = value[12];
    const textB = value.length > 13 ? value[13] : null;
    if (textA !== null && typeof textA !== "string") malformed(`compact lane ${key}.expressions.a must be a string or null`);
    if (textB !== null && typeof textB !== "string") malformed(`compact lane ${key}.expressions.b must be a string`);
    const expressions: { a?: string; b?: string } = {};
    if (typeof textA === "string" && textA !== "") expressions.a = textA;
    if (typeof textB === "string" && textB !== "") expressions.b = textB;
    if (Object.keys(expressions).length > 0) lane.expressions = expressions;
  }
  return [key, lane];
}

/**
 * Expand a compact payload value (the decoded JSON array) back to a
 * canonical-shaped schema-4 document. Unknown top-level fields are restored
 * from `x`. Throws `ProjectError` on a structurally corrupt/truncated array and
 * `newer-schema` when the tag is newer than this build.
 */
export function decodeCompactShare(value: unknown): ProjectDoc {
  if (!Array.isArray(value)) malformed("compact share payload must be a JSON array");
  const tag = value[0];
  if (!Number.isInteger(tag)) malformed("compact share tag must be an integer");
  if ((tag as number) > COMPACT_SHARE_TAG) {
    throw new ProjectError(
      "newer-schema",
      `share codec ${String(tag)} is newer than supported ${COMPACT_SHARE_TAG}; open it read-only`,
    );
  }
  if (tag !== 4 && tag !== COMPACT_SHARE_TAG) malformed(`unknown compact share tag: ${String(tag)}`);
  if (value.length < 6) malformed("compact share payload is truncated");

  const N = value[1];
  if (!Number.isInteger(N) || (N as number) < 8 || (N as number) > 256 || (N as number) % 8 !== 0) {
    malformed(`compact share width must be 8..256 in multiples of 8; got ${String(N)}`);
  }
  const view = decodeCompactView(value[2], tag as number);

  if (!Array.isArray(value[3]) || value[3].length === 0) malformed("compact share needs at least one lane");
  const lanes: Record<LaneKey, ProjectLane> = {};
  for (const rawLane of value[3]) {
    const [key, lane] = decodeCompactLane(rawLane, N as number);
    if (Object.prototype.hasOwnProperty.call(lanes, key)) malformed(`compact share repeats lane ${key}`);
    lanes[key] = lane;
  }

  if (!Array.isArray(value[4])) malformed("compact share routes must be an array");
  const routes: ProjectRoute[] = value[4].map((rawRoute) => {
    if (!Array.isArray(rawRoute) || rawRoute.length !== 5) malformed("compact route must be a 5-field tuple");
    const mix = MIX_ORDER[rawRoute[4] as number];
    if (rawRoute[4] !== 0 && rawRoute[4] !== 1 && rawRoute[4] !== 2) {
      malformed("compact route mix must be an index in [0, 2]");
    }
    return {
      from: decodeCompactPort(rawRoute[0], rawRoute[1], tag as number, "compact route.from"),
      to: decodeCompactPort(rawRoute[2], rawRoute[3], tag as number, "compact route.to"),
      mix,
    };
  });

  if (!Array.isArray(value[5])) malformed("compact share parked bases must be an array");
  const parked: Record<string, string> = {};
  for (const rawBase of value[5]) {
    if (!Array.isArray(rawBase) || rawBase.length !== 3) malformed("compact parked base must be a 3-field tuple");
    const port = decodeCompactPort(rawBase[0], rawBase[1], tag as number, "compact parked");
    parked[port] = expandRegister(rawBase[2], N as number, `compact parked.${port}`);
  }

  const doc: Record<string, unknown> = {
    schema: tag,
    app: PROJECT_APP,
    N,
    view,
    lanes,
    routes,
    parked,
  };

  if (value.length > 6 && value[6] !== null) {
    const rawDataset = value[6];
    if (!Array.isArray(rawDataset) || rawDataset.length < 2 || rawDataset.length > 3) {
      malformed("compact dataset must be [cols, rows] or [cols, rows, index]");
    }
    if (!Array.isArray(rawDataset[0]) || !Array.isArray(rawDataset[1])) {
      malformed("compact dataset needs column and row arrays");
    }
    const dataset: Record<string, unknown> = { cols: rawDataset[0], rows: rawDataset[1] };
    if (rawDataset.length === 3) {
      if (!Number.isInteger(rawDataset[2]) || (rawDataset[2] as number) < 0) {
        malformed("compact dataset index must be a non-negative integer");
      }
      dataset.index = rawDataset[2];
    }
    doc.dataset = dataset;
  }
  if (value.length > 7 && value[7] !== null) {
    const extras = value[7];
    if (!isObjectValue(extras)) malformed("compact share extras must be an object");
    for (const [key, extra] of Object.entries(extras)) {
      if (!SHARE_DOC_KEYS.has(key)) doc[key] = extra;
    }
  }
  if (value.length > 8) {
    if ((tag as number) < 5 || value.length > 9) {
      malformed("compact share payload has unexpected trailing fields");
    }
    if (!Array.isArray(value[8])) malformed("compact share frames must be an array");
    const frames: Record<FreeFrameKey, ProjectFreeFrame> = {};
    for (const rawFrame of value[8]) {
      const [key, ff] = decodeCompactFreeFrame(rawFrame, N as number);
      if (Object.prototype.hasOwnProperty.call(frames, key)) {
        malformed(`compact share repeats free frame F${key}`);
      }
      frames[key] = ff;
    }
    if (Object.keys(frames).length > 0) doc.frames = frames;
  }
  return doc as unknown as ProjectDoc;
}

/**
 * Inspect a decoded share value: a JSON array is the compact payload (expanded
 * to a canonical-shaped schema-4 document), an object is a legacy schema 1–4
 * document returned as-is for `deserializeProject` to upgrade on read.
 */
export function decodeShareDocument(value: unknown): ProjectDoc {
  if (Array.isArray(value)) return decodeCompactShare(value);
  if (isObjectValue(value)) return value as unknown as ProjectDoc;
  return malformed("share payload is not a document");
}

/**
 * Read a shared document from a `location.hash`, accepting either the full
 * fragment (`#bw=...`) or the bare payload form (`bw=...`). Returns null when
 * the hash carries no share (empty, a different fragment, or `bw=` with no
 * payload); a present-but-corrupt payload throws ProjectError. Compact payloads
 * are expanded to a schema-4 document; legacy JSON payloads are returned raw
 * and upgrade in `deserializeProject`.
 */
export function parseShareHash(hash: string): unknown | null {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!text.startsWith(SHARE_PREFIX)) return null;
  const payload = text.slice(SHARE_PREFIX.length);
  if (payload === "") return null;
  return decodeShareDocument(decodeShare(payload));
}
