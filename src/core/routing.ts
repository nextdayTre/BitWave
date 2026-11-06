/**
 * Routing engine — cross-view patch cords + delayed within-view feedback.
 *
 * Sources: A, B or Z of any view (9 outputs). Destinations: A or B of any view
 * (6 inputs). Z is never a destination: it is a function of its operands
 * (DESIGN §10.8). One cable per input in v1; adding a second replaces the first.
 *
 * A patched input is DRIVEN. Its pre-patch value is parked when the first cable
 * attaches and restored byte-identically when the last cable is removed — the
 * same discipline the LFO already uses (DESIGN §10.18).
 *
 * Evaluation is clocked: markDelays() finds back edges on the view graph and
 * flags them `delay`, topoOrder() orders the acyclic remainder, and
 * evaluateAll() samples delayed sources BEFORE writing, then resolves views in
 * dependency order. That makes feedback explicitly one evaluation late (z^-1)
 * instead of an algebraic loop with no fixed point, and chains settle in one
 * pass. Callers invoke it on transaction boundaries only (never per frame).
 */

import type {
  DestinationPort,
  FrameKey,
  MixOp,
  Route,
  Slot,
  SlotKey,
  SlotMap,
  SourcePort,
} from "./types.ts";
import { SLOT_KEYS } from "./types.ts";
import {
  bigToReg,
  bitsToNibbles,
  nibblesToBits,
  regToBig,
  remapNibbles,
} from "./registers.ts";
import { computeZ } from "./derive.ts";

export interface RoutingState {
  routes: Route[];
  /** Destination port key ("A:a") -> pre-patch bits, captured on first attach. */
  parked: Map<string, Uint8Array>;
}

export const createRouting = (): RoutingState => ({ routes: [], parked: new Map() });

export const portKey = (slot: SlotKey, frame: FrameKey): string => `${slot}:${frame}`;
export const routeKey = (from: SourcePort, to: DestinationPort): string =>
  `${from.slot}:${from.frame}>${to.slot}:${to.frame}`;

const sameDest = (a: DestinationPort, b: DestinationPort): boolean =>
  a.slot === b.slot && a.frame === b.frame;

const operandReg = (slot: Slot, frame: "a" | "b") => (frame === "a" ? slot.A : slot.B);

function readPort(slots: SlotMap, slotKey: SlotKey, frame: FrameKey): Uint8Array {
  const slot = slots[slotKey];
  return frame === "z" ? slot.Z.bits : frame === "b" ? slot.B.bits : slot.A.bits;
}

export function isDriven(routing: RoutingState, slot: SlotKey, frame: "a" | "b"): boolean {
  return routing.routes.some((r) => r.to.slot === slot && r.to.frame === frame);
}

export function driverOf(routing: RoutingState, slot: SlotKey, frame: "a" | "b"): Route | undefined {
  return routing.routes.find((r) => r.to.slot === slot && r.to.frame === frame);
}

export function routesInto(routing: RoutingState, slot: SlotKey, frame: "a" | "b"): Route[] {
  return routing.routes.filter((r) => r.to.slot === slot && r.to.frame === frame);
}

export function routeById(routing: RoutingState, id: string): Route | undefined {
  return routing.routes.find((r) => r.id === id);
}

/**
 * Attach a cable. Returns the new route. Throws on an invalid wiring request
 * rather than silently doing something surprising.
 */
export function addRoute(
  routing: RoutingState,
  slots: SlotMap,
  from: SourcePort,
  to: DestinationPort,
  mix: MixOp = "set",
): Route {
  if (!SLOT_KEYS.includes(from.slot) || !SLOT_KEYS.includes(to.slot)) {
    throw new TypeError(`unknown view in cable ${JSON.stringify({ from, to })}`);
  }
  if (from.frame !== "a" && from.frame !== "b" && from.frame !== "z") {
    throw new TypeError(`unknown source frame: ${String(from.frame)}`);
  }
  if (to.frame !== "a" && to.frame !== "b") {
    throw new TypeError("Z is derived and cannot be a cable destination (DESIGN §10.8)");
  }
  if (from.slot === to.slot && from.frame === to.frame) {
    throw new Error("identity cable is not a route");
  }

  const hadDriver = isDriven(routing, to.slot, to.frame);
  // One cable per input (v1): a second cable replaces the first, matching the
  // "single-link socket" convention. Parking is retained across the swap.
  routing.routes = routing.routes.filter((r) => !sameDest(r.to, to));
  if (!hadDriver) {
    const base = readPort(slots, to.slot, to.frame);
    routing.parked.set(portKey(to.slot, to.frame), base.slice());
  }

  const route: Route = { id: routeKey(from, to), from: { ...from }, to: { ...to }, delay: false, mix };
  routing.routes.push(route);
  markDelays(routing);
  return route;
}

/** Remove a cable by id. Restores the parked base when its input becomes free. */
export function removeRoute(routing: RoutingState, slots: SlotMap, id: string): boolean {
  const index = routing.routes.findIndex((r) => r.id === id);
  if (index < 0) return false;
  const [route] = routing.routes.splice(index, 1);
  if (!isDriven(routing, route.to.slot, route.to.frame)) {
    restoreDestination(routing, slots, route.to.slot, route.to.frame);
  }
  markDelays(routing);
  return true;
}

/** Restore a driven input's parked base. Returns false if nothing was parked. */
export function restoreDestination(
  routing: RoutingState,
  slots: SlotMap,
  slot: SlotKey,
  frame: "a" | "b",
): boolean {
  const key = portKey(slot, frame);
  const base = routing.parked.get(key);
  if (!base) return false;
  const dest = operandReg(slots[slot], frame);
  if (base.length !== dest.bits.length) {
    throw new Error(
      `parked base for ${key} is ${base.length} bits but the register is ${dest.bits.length}; call remapParked() around a resize`,
    );
  }
  dest.bits.set(base);
  routing.parked.delete(key);
  return true;
}

/** Remove every cable (convenience for boot/reset paths). */
export function clearRoutes(routing: RoutingState, slots: SlotMap): void {
  for (const route of [...routing.routes]) removeRoute(routing, slots, route.id);
}

/**
 * Classify cycle-closing cables. DFS over the view graph: an edge to a gray
 * node is a back edge and gets `delay = true`. Deterministic in SLOT_KEYS order
 * and route insertion order. A self-view cable (3·Z -> 3·A) is always delayed.
 */
export function markDelays(routing: RoutingState): void {
  const color: Record<SlotKey, 0 | 1 | 2> = { A: 0, B: 0, C: 0 };
  const edges: Record<SlotKey, Route[]> = { A: [], B: [], C: [] };
  for (const route of routing.routes) edges[route.from.slot].push(route);

  const visit = (slotKey: SlotKey): void => {
    color[slotKey] = 1;
    for (const route of edges[slotKey]) {
      const target = route.to.slot;
      if (color[target] === 1) {
        route.delay = true; // back edge closes a cycle
        continue;
      }
      route.delay = false;
      if (color[target] === 0) visit(target);
    }
    color[slotKey] = 2;
  };

  for (const key of SLOT_KEYS) if (color[key] === 0) visit(key);
}

/**
 * Dependency order over the acyclic (non-delayed) edges: a cable X -> Y is
 * applied after X has settled, so chains resolve in one pass. Call
 * markDelays() first (evaluateAll does).
 */
export function topoOrder(routing: RoutingState): SlotKey[] {
  const color: Record<SlotKey, 0 | 1 | 2> = { A: 0, B: 0, C: 0 };
  const edges: Record<SlotKey, SlotKey[]> = { A: [], B: [], C: [] };
  for (const route of routing.routes) {
    if (!route.delay) edges[route.from.slot].push(route.to.slot);
  }

  const order: SlotKey[] = [];
  const visit = (slotKey: SlotKey): void => {
    color[slotKey] = 1;
    for (const target of edges[slotKey]) if (color[target] === 0) visit(target);
    color[slotKey] = 2;
    order.push(slotKey);
  };
  for (const key of SLOT_KEYS) if (color[key] === 0) visit(key);

  return order.reverse();
}

function combine(values: Uint8Array[], N: number, mix: MixOp): Uint8Array {
  if (values.length === 0) throw new Error("combine: no values");
  if (values.length === 1 || mix === "set") return values[values.length - 1].slice();

  if (mix === "xor") {
    const out = new Uint8Array(N);
    for (const value of values) for (let i = 0; i < N; i++) out[i] ^= value[i];
    return out;
  }

  // add mod 2^N — the bit-level analogue of summing at one audio inlet.
  let sum = 0n;
  for (const value of values) sum += regToBig(value, N);
  const out = new Uint8Array(N);
  bigToReg(sum, out, N);
  return out;
}

/**
 * The single evaluation entry point. Applies all cables, then derives Z for
 * every view. Base writes (drag, preset, op, CSV, LFO) must complete first;
 * renderers sync targets afterwards. Never call per animation frame.
 */
export function evaluateAll(routing: RoutingState, slots: SlotMap, N: number): void {
  markDelays(routing);
  const order = topoOrder(routing);

  // Sample every delayed source before any write: that snapshot is exactly one
  // evaluation old, and needs no stored state to survive resize or unroute.
  const delayed = new Map<string, Uint8Array>();
  for (const route of routing.routes) {
    if (route.delay) {
      delayed.set(route.id, readPort(slots, route.from.slot, route.from.frame).slice());
    }
  }

  for (const slotKey of order) {
    const slot = slots[slotKey];
    const incoming = routing.routes.filter((r) => r.to.slot === slotKey);

    for (const frame of ["a", "b"] as const) {
      const into = incoming.filter((r) => r.to.frame === frame);
      if (into.length === 0) continue;
      const values = into.map((r) =>
        r.delay ? delayed.get(r.id)! : readPort(slots, r.from.slot, r.from.frame),
      );
      operandReg(slot, frame).bits.set(combine(values, N, into[into.length - 1].mix));
    }

    slot.Z.bits = computeZ(slot.A.bits, slot.B.bits, N, slot.binop);
  }
}

/** Remap parked bases around a width change so unpatch equals no-cable resize. */
export function remapParked(routing: RoutingState, oldN: number, newN: number): void {
  for (const [key, bits] of routing.parked) {
    const values = remapNibbles(bitsToNibbles(bits, oldN), oldN, newN);
    routing.parked.set(key, nibblesToBits(values, newN));
  }
}
