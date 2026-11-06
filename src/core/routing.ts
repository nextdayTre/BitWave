/**
 * Routing engine — cross-lane routes + delayed within-lane feedback.
 *
 * Sources: A, B or Z of any lane (9 outputs). Destinations: A or B of any lane
 * (6 inputs). Z is never a destination: it is a function of its operands
 * (DESIGN §10.8). One route per input in v1; adding a second replaces the first.
 *
 * A patched input is DRIVEN. Its pre-patch value is parked when the first route
 * attaches and restored byte-identically when the last route is removed — the
 * same discipline the LFO already uses (DESIGN §10.18).
 *
 * Evaluation is clocked: markDelays() finds back edges on the lane graph and
 * flags them `delay`, topoOrder() orders the acyclic remainder, and
 * evaluateAll() samples delayed sources BEFORE writing, then resolves lanes in
 * dependency order. That makes feedback explicitly one evaluation late (z^-1)
 * instead of an algebraic loop with no fixed point, and chains settle in one
 * pass. Callers invoke it on transaction boundaries only (never per frame).
 */

import type {
  DestinationPort,
  FrameKey,
  MixOp,
  Route,
  Lane,
  LaneKey,
  LaneMap,
  SourcePort,
} from "./types.ts";
import { LANE_KEYS } from "./types.ts";
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
  /** Destination port key ("1:a") -> pre-patch bits, captured on first attach. */
  parked: Map<string, Uint8Array>;
}

export const createRouting = (): RoutingState => ({ routes: [], parked: new Map() });

export const portKey = (lane: LaneKey, frame: FrameKey): string => `${lane}:${frame}`;
export const routeKey = (from: SourcePort, to: DestinationPort): string =>
  `${from.lane}:${from.frame}>${to.lane}:${to.frame}`;

const sameDest = (a: DestinationPort, b: DestinationPort): boolean =>
  a.lane === b.lane && a.frame === b.frame;

const operandReg = (lane: Lane, frame: "a" | "b") => (frame === "a" ? lane.A : lane.B);

function readPort(lanes: LaneMap, laneKey: LaneKey, frame: FrameKey): Uint8Array {
  const lane = lanes[laneKey];
  return frame === "z" ? lane.Z.bits : frame === "b" ? lane.B.bits : lane.A.bits;
}

export function isDriven(routing: RoutingState, lane: LaneKey, frame: "a" | "b"): boolean {
  return routing.routes.some((r) => r.to.lane === lane && r.to.frame === frame);
}

export function driverOf(routing: RoutingState, lane: LaneKey, frame: "a" | "b"): Route | undefined {
  return routing.routes.find((r) => r.to.lane === lane && r.to.frame === frame);
}

export function routesInto(routing: RoutingState, lane: LaneKey, frame: "a" | "b"): Route[] {
  return routing.routes.filter((r) => r.to.lane === lane && r.to.frame === frame);
}

export function routeById(routing: RoutingState, id: string): Route | undefined {
  return routing.routes.find((r) => r.id === id);
}

/**
 * Attach a route. Returns the new route. Throws on an invalid wiring request
 * rather than silently doing something surprising.
 */
export function addRoute(
  routing: RoutingState,
  lanes: LaneMap,
  from: SourcePort,
  to: DestinationPort,
  mix: MixOp = "set",
): Route {
  if (!LANE_KEYS.includes(from.lane) || !LANE_KEYS.includes(to.lane)) {
    throw new TypeError(`unknown lane in route ${JSON.stringify({ from, to })}`);
  }
  if (from.frame !== "a" && from.frame !== "b" && from.frame !== "z") {
    throw new TypeError(`unknown source frame: ${String(from.frame)}`);
  }
  if (to.frame !== "a" && to.frame !== "b") {
    throw new TypeError("Z is derived and cannot be a route destination (DESIGN §10.8)");
  }
  if (from.lane === to.lane && from.frame === to.frame) {
    throw new Error("identity route is not a route");
  }

  const hadDriver = isDriven(routing, to.lane, to.frame);
  // One route per input (v1): a second route replaces the first, matching the
  // "single-link socket" convention. Parking is retained across the swap.
  routing.routes = routing.routes.filter((r) => !sameDest(r.to, to));
  if (!hadDriver) {
    const base = readPort(lanes, to.lane, to.frame);
    routing.parked.set(portKey(to.lane, to.frame), base.slice());
  }

  const route: Route = { id: routeKey(from, to), from: { ...from }, to: { ...to }, delay: false, mix };
  routing.routes.push(route);
  markDelays(routing);
  return route;
}

/** Remove a route by id. Restores the parked base when its input becomes free. */
export function removeRoute(routing: RoutingState, lanes: LaneMap, id: string): boolean {
  const index = routing.routes.findIndex((r) => r.id === id);
  if (index < 0) return false;
  const [route] = routing.routes.splice(index, 1);
  if (!isDriven(routing, route.to.lane, route.to.frame)) {
    restoreDestination(routing, lanes, route.to.lane, route.to.frame);
  }
  markDelays(routing);
  return true;
}

/** Restore a driven input's parked base. Returns false if nothing was parked. */
export function restoreDestination(
  routing: RoutingState,
  lanes: LaneMap,
  lane: LaneKey,
  frame: "a" | "b",
): boolean {
  const key = portKey(lane, frame);
  const base = routing.parked.get(key);
  if (!base) return false;
  const dest = operandReg(lanes[lane], frame);
  if (base.length !== dest.bits.length) {
    throw new Error(
      `parked base for ${key} is ${base.length} bits but the register is ${dest.bits.length}; call remapParked() around a resize`,
    );
  }
  dest.bits.set(base);
  routing.parked.delete(key);
  return true;
}

/** Remove every route (convenience for boot/reset paths). */
export function clearRoutes(routing: RoutingState, lanes: LaneMap): void {
  for (const route of [...routing.routes]) removeRoute(routing, lanes, route.id);
}

/**
 * Classify cycle-closing routes. DFS over the lane graph: an edge to a gray
 * node is a back edge and gets `delay = true`. Deterministic in LANE_KEYS order
 * and route insertion order. A self-lane route (3·Z -> 3·A) is always delayed.
 */
export function markDelays(routing: RoutingState): void {
  const color: Record<LaneKey, 0 | 1 | 2> = { "1": 0, "2": 0, "3": 0 };
  const edges: Record<LaneKey, Route[]> = { "1": [], "2": [], "3": [] };
  for (const route of routing.routes) edges[route.from.lane].push(route);

  const visit = (laneKey: LaneKey): void => {
    color[laneKey] = 1;
    for (const route of edges[laneKey]) {
      const target = route.to.lane;
      if (color[target] === 1) {
        route.delay = true; // back edge closes a cycle
        continue;
      }
      route.delay = false;
      if (color[target] === 0) visit(target);
    }
    color[laneKey] = 2;
  };

  for (const key of LANE_KEYS) if (color[key] === 0) visit(key);
}

/**
 * Dependency order over the acyclic (non-delayed) edges: a route X -> Y is
 * applied after X has settled, so chains resolve in one pass. Call
 * markDelays() first (evaluateAll does).
 */
export function topoOrder(routing: RoutingState): LaneKey[] {
  const color: Record<LaneKey, 0 | 1 | 2> = { "1": 0, "2": 0, "3": 0 };
  const edges: Record<LaneKey, LaneKey[]> = { "1": [], "2": [], "3": [] };
  for (const route of routing.routes) {
    if (!route.delay) edges[route.from.lane].push(route.to.lane);
  }

  const order: LaneKey[] = [];
  const visit = (laneKey: LaneKey): void => {
    color[laneKey] = 1;
    for (const target of edges[laneKey]) if (color[target] === 0) visit(target);
    color[laneKey] = 2;
    order.push(laneKey);
  };
  for (const key of LANE_KEYS) if (color[key] === 0) visit(key);

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
 * The single evaluation entry point. Applies all routes, then derives Z for
 * every lane. Base writes (drag, preset, op, CSV, LFO) must complete first;
 * renderers sync targets afterwards. Never call per animation frame.
 */
export function evaluateAll(routing: RoutingState, lanes: LaneMap, N: number): void {
  markDelays(routing);
  const order = topoOrder(routing);

  // Sample every delayed source before any write: that snapshot is exactly one
  // evaluation old, and needs no stored state to survive resize or unroute.
  const delayed = new Map<string, Uint8Array>();
  for (const route of routing.routes) {
    if (route.delay) {
      delayed.set(route.id, readPort(lanes, route.from.lane, route.from.frame).slice());
    }
  }

  for (const laneKey of order) {
    const lane = lanes[laneKey];
    const incoming = routing.routes.filter((r) => r.to.lane === laneKey);

    for (const frame of ["a", "b"] as const) {
      const into = incoming.filter((r) => r.to.frame === frame);
      if (into.length === 0) continue;
      const values = into.map((r) =>
        r.delay ? delayed.get(r.id)! : readPort(lanes, r.from.lane, r.from.frame),
      );
      operandReg(lane, frame).bits.set(combine(values, N, into[into.length - 1].mix));
    }

    lane.Z.bits = computeZ(lane.A.bits, lane.B.bits, N, lane.binop);
  }
}

/** Remap parked bases around a width change so unpatch equals no-route resize. */
export function remapParked(routing: RoutingState, oldN: number, newN: number): void {
  for (const [key, bits] of routing.parked) {
    const values = remapNibbles(bitsToNibbles(bits, oldN), oldN, newN);
    routing.parked.set(key, nibblesToBits(values, newN));
  }
}
