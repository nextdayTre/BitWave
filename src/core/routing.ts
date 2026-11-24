/**
 * Routing engine — cross-lane, free-frame, and delayed feedback routes.
 *
 * Sources: A, B or Z of any live lane, OR any live free frame (F1..F16, D52).
 * Destinations: A or B of any live lane, OR any live free frame. Z is never a
 * destination: it is a function of its operands (DESIGN §10.8). One route per
 * input in v1; adding a second replaces the first.
 *
 * A patched input is DRIVEN. Its pre-patch value is parked when the first route
 * attaches and restored byte-identically when the last route is removed — the
 * same discipline the LFO already uses (DESIGN §10.18).
 *
 * Evaluation is clocked: markDelays() finds back edges on the unified graph
 * (lanes ∪ free frames) and flags them `delay`, topoOrderNodes() orders the
 * acyclic remainder, and evaluateAll() samples delayed sources BEFORE writing,
 * then resolves nodes in dependency order. That makes feedback explicitly one
 * evaluation late (z^-1) instead of an algebraic loop with no fixed point, and
 * linear chains settle in one pass. Callers invoke it on transaction boundaries
 * only (never per frame).
 */

import type {
  DestinationPort,
  FrameKey,
  FreeFrameKey,
  FreeFrameMap,
  MixOp,
  OperandKey,
  Register,
  Route,
  Lane,
  LaneKey,
  LaneMap,
  SourcePort,
} from "./types.ts";
import { LANE_KEYS, isFreePort } from "./types.ts";
import { compareFreeFrameKeys, compareLaneKeys, freeFrameName } from "./lanedefs.ts";
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
  /** Destination port key ("1:a" or "F1") -> pre-patch bits, captured on first attach. */
  parked: Map<string, Uint8Array>;
}

export type GraphNode =
  | { kind: "lane"; key: LaneKey }
  | { kind: "free"; key: FreeFrameKey };

export const createRouting = (): RoutingState => ({ routes: [], parked: new Map() });

export const portKey = (lane: LaneKey, frame: FrameKey): string => `${lane}:${frame}`;
export const freePortKey = (freeKey: FreeFrameKey): string => freeFrameName(freeKey);
export const portKeyOf = (port: SourcePort | DestinationPort): string =>
  isFreePort(port) ? freePortKey(port.free) : portKey(port.lane, port.frame);

export const routeKey = (from: SourcePort, to: DestinationPort): string =>
  `${portKeyOf(from)}>${portKeyOf(to)}`;

/**
 * The lane keys present in a lane map, in canonical ascending numeric order.
 */
export const laneKeysOf = (lanes: LaneMap): LaneKey[] => Object.keys(lanes).sort(compareLaneKeys);

/**
 * The free-frame keys present in a free-frame map, in canonical ascending numeric order.
 */
export const freeFrameKeysOf = (freeFrames?: FreeFrameMap): FreeFrameKey[] =>
  freeFrames ? Object.keys(freeFrames).sort(compareFreeFrameKeys) : [];

const sameDest = (a: DestinationPort, b: DestinationPort): boolean => portKeyOf(a) === portKeyOf(b);

const operandReg = (lane: Lane, frame: "a" | "b"): Register => (frame === "a" ? lane.A : lane.B);

function destReg(lanes: LaneMap, port: DestinationPort, freeFrames?: FreeFrameMap): Register {
  if (isFreePort(port)) {
    const ff = freeFrames?.[port.free];
    if (!ff) throw new TypeError(`unknown free frame in route: ${port.free}`);
    return ff.reg;
  }
  return operandReg(lanes[port.lane], port.frame);
}

function readSourcePort(lanes: LaneMap, port: SourcePort, freeFrames?: FreeFrameMap): Uint8Array {
  if (isFreePort(port)) {
    const ff = freeFrames?.[port.free];
    if (!ff) throw new TypeError(`unknown free frame in route: ${port.free}`);
    return ff.reg.bits;
  }
  const lane = lanes[port.lane];
  return port.frame === "z" ? lane.Z.bits : port.frame === "b" ? lane.B.bits : lane.A.bits;
}

export function isPortDriven(routing: RoutingState, port: DestinationPort): boolean {
  const key = portKeyOf(port);
  return routing.routes.some((r) => portKeyOf(r.to) === key);
}

export function isDriven(routing: RoutingState, lane: LaneKey, frame: "a" | "b"): boolean {
  return isPortDriven(routing, { lane, frame });
}

export function isFreeDriven(routing: RoutingState, freeKey: FreeFrameKey): boolean {
  return isPortDriven(routing, { free: freeKey });
}

export function portDriverOf(routing: RoutingState, port: DestinationPort): Route | undefined {
  const key = portKeyOf(port);
  return routing.routes.find((r) => portKeyOf(r.to) === key);
}

export function driverOf(routing: RoutingState, lane: LaneKey, frame: "a" | "b"): Route | undefined {
  return portDriverOf(routing, { lane, frame });
}

export function freeDriverOf(routing: RoutingState, freeKey: FreeFrameKey): Route | undefined {
  return portDriverOf(routing, { free: freeKey });
}

export function routesIntoPort(routing: RoutingState, port: DestinationPort): Route[] {
  const key = portKeyOf(port);
  return routing.routes.filter((r) => portKeyOf(r.to) === key);
}

export function routesInto(routing: RoutingState, lane: LaneKey, frame: "a" | "b"): Route[] {
  return routesIntoPort(routing, { lane, frame });
}

export function routeById(routing: RoutingState, id: string): Route | undefined {
  return routing.routes.find((r) => r.id === id);
}

function validateSourcePort(from: SourcePort, lanes: LaneMap, freeFrames?: FreeFrameMap): void {
  if (isFreePort(from)) {
    if (!freeFrames || !freeFrames[from.free]) {
      throw new TypeError(`unknown free frame in route ${JSON.stringify(from)}`);
    }
    return;
  }
  if (!lanes[from.lane]) {
    throw new TypeError(`unknown lane in route ${JSON.stringify(from)}`);
  }
  if (from.frame !== "a" && from.frame !== "b" && from.frame !== "z") {
    throw new TypeError(`unknown source frame: ${String(from.frame)}`);
  }
}

function validateDestPort(to: DestinationPort, lanes: LaneMap, freeFrames?: FreeFrameMap): void {
  if (isFreePort(to)) {
    if (!freeFrames || !freeFrames[to.free]) {
      throw new TypeError(`unknown free frame in route ${JSON.stringify(to)}`);
    }
    return;
  }
  if (!lanes[to.lane]) {
    throw new TypeError(`unknown lane in route ${JSON.stringify(to)}`);
  }
  if (to.frame !== "a" && to.frame !== "b") {
    throw new TypeError("Z is derived and cannot be a route destination (DESIGN §10.8)");
  }
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
  freeFrames?: FreeFrameMap,
): Route {
  validateSourcePort(from, lanes, freeFrames);
  validateDestPort(to, lanes, freeFrames);
  if (portKeyOf(from) === portKeyOf(to)) {
    throw new Error("identity route is not a route");
  }

  const hadDriver = isPortDriven(routing, to);
  // One route per input (v1): a second route replaces the first, matching the
  // "single-link socket" convention. Parking is retained across the swap.
  routing.routes = routing.routes.filter((r) => !sameDest(r.to, to));
  if (!hadDriver) {
    const base = destReg(lanes, to, freeFrames).bits;
    routing.parked.set(portKeyOf(to), base.slice());
  }

  const route: Route = {
    id: routeKey(from, to),
    from: { ...from },
    to: { ...to },
    delay: false,
    mix,
  };
  routing.routes.push(route);
  markDelays(routing, laneKeysOf(lanes), freeFrameKeysOf(freeFrames));
  return route;
}

/** Remove a route by id. Restores the parked base when its input becomes free. */
export function removeRoute(
  routing: RoutingState,
  lanes: LaneMap,
  id: string,
  freeFrames?: FreeFrameMap,
): boolean {
  const index = routing.routes.findIndex((r) => r.id === id);
  if (index < 0) return false;
  const [route] = routing.routes.splice(index, 1);
  if (!isPortDriven(routing, route.to)) {
    restorePort(routing, lanes, route.to, freeFrames);
  }
  markDelays(routing, laneKeysOf(lanes), freeFrameKeysOf(freeFrames));
  return true;
}

/** Restore a driven port's parked base (lane operand or free frame). */
export function restorePort(
  routing: RoutingState,
  lanes: LaneMap,
  port: DestinationPort,
  freeFrames?: FreeFrameMap,
): boolean {
  const key = portKeyOf(port);
  const base = routing.parked.get(key);
  if (!base) return false;
  const dest = destReg(lanes, port, freeFrames);
  if (base.length !== dest.bits.length) {
    throw new Error(
      `parked base for ${key} is ${base.length} bits but the register is ${dest.bits.length}; call remapParked() around a resize`,
    );
  }
  dest.bits.set(base);
  routing.parked.delete(key);
  return true;
}

/** Restore a driven lane operand's parked base. Returns false if nothing was parked. */
export function restoreDestination(
  routing: RoutingState,
  lanes: LaneMap,
  lane: LaneKey,
  frame: "a" | "b",
): boolean {
  return restorePort(routing, lanes, { lane, frame });
}

/** Remove every route (convenience for boot/reset paths). */
export function clearRoutes(
  routing: RoutingState,
  lanes: LaneMap,
  freeFrames?: FreeFrameMap,
): void {
  for (const route of [...routing.routes]) removeRoute(routing, lanes, route.id, freeFrames);
}

type NodeId = string;
const laneNodeId = (key: LaneKey): NodeId => `L:${key}`;
const freeNodeId = (key: FreeFrameKey): NodeId => `F:${key}`;
const portNodeId = (port: SourcePort | DestinationPort): NodeId =>
  isFreePort(port) ? freeNodeId(port.free) : laneNodeId(port.lane);

function allNodeIds(
  laneKeys: readonly LaneKey[],
  freeKeys: readonly FreeFrameKey[],
): NodeId[] {
  return [...laneKeys.map(laneNodeId), ...freeKeys.map(freeNodeId)];
}

/**
 * Classify cycle-closing routes. DFS over the unified graph (lanes ∪ free frames):
 * an edge to a gray node is a back edge and gets `delay = true`. Deterministic in
 * ascending lane-key order, then ascending free-frame order, and route insertion
 * order. A self-lane route (3·Z -> 3·A) is always delayed.
 */
export function markDelays(
  routing: RoutingState,
  laneKeys: readonly LaneKey[] = LANE_KEYS,
  freeKeys: readonly FreeFrameKey[] = [],
): void {
  const nodes = allNodeIds(laneKeys, freeKeys);
  const color = new Map<NodeId, 0 | 1 | 2>();
  const edges = new Map<NodeId, Route[]>();
  for (const id of nodes) {
    color.set(id, 0);
    edges.set(id, []);
  }
  for (const route of routing.routes) {
    const src = portNodeId(route.from);
    edges.get(src)?.push(route);
  }

  const visit = (nodeId: NodeId): void => {
    color.set(nodeId, 1);
    for (const route of edges.get(nodeId) ?? []) {
      const target = portNodeId(route.to);
      if (color.get(target) === 1) {
        route.delay = true; // back edge closes a cycle
        continue;
      }
      route.delay = false;
      if (color.get(target) === 0) visit(target);
    }
    color.set(nodeId, 2);
  };

  for (const id of nodes) if (color.get(id) === 0) visit(id);
}

/**
 * Dependency order over the unified graph (lanes ∪ free frames) for acyclic
 * (non-delayed) edges: a route X -> Y is applied after X has settled, so chains
 * resolve in one pass. `markDelays()` must run first (evaluateAll does).
 */
export function topoOrderNodes(
  routing: RoutingState,
  laneKeys: readonly LaneKey[] = LANE_KEYS,
  freeKeys: readonly FreeFrameKey[] = [],
): GraphNode[] {
  const nodes = allNodeIds(laneKeys, freeKeys);
  const color = new Map<NodeId, 0 | 1 | 2>();
  const edges = new Map<NodeId, NodeId[]>();
  for (const id of nodes) {
    color.set(id, 0);
    edges.set(id, []);
  }
  for (const route of routing.routes) {
    if (!route.delay) {
      edges.get(portNodeId(route.from))?.push(portNodeId(route.to));
    }
  }

  const order: NodeId[] = [];
  const visit = (nodeId: NodeId): void => {
    color.set(nodeId, 1);
    for (const target of edges.get(nodeId) ?? []) {
      if (color.get(target) === 0) visit(target);
    }
    color.set(nodeId, 2);
    order.push(nodeId);
  };
  /* Iterate in reverse so `order.reverse()` visits disconnected/expression-chained
     nodes in natural ascending order (L:1..L:k, F:1..F:m) while preserving every
     route edge dependency u -> v. */
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const id = nodes[i];
    if (color.get(id) === 0) visit(id);
  }

  return order.reverse().map((id): GraphNode =>
    id.startsWith("F:")
      ? { kind: "free", key: id.slice(2) }
      : { kind: "lane", key: id.slice(2) },
  );
}

/**
 * Lane-only dependency order (preserved for existing callers and tests).
 */
export function topoOrder(
  routing: RoutingState,
  laneKeys: readonly LaneKey[] = LANE_KEYS,
): LaneKey[] {
  return topoOrderNodes(routing, laneKeys, [])
    .filter((node): node is { kind: "lane"; key: LaneKey } => node.kind === "lane")
    .map((node) => node.key);
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
 * Optional per-evaluation hooks. `applyExpression` runs after a lane's incoming
 * routes have been written and before its Z is derived; `applyFreeExpression`
 * runs after a free frame's incoming route has been written. Nodes are visited
 * in route dependency order, so downstream nodes see settled upstream values.
 */
export interface EvaluateHooks {
  applyExpression?: (lane: LaneKey, frame: OperandKey, lanes: LaneMap, N: number) => void;
  applyFreeExpression?: (
    freeKey: FreeFrameKey,
    lanes: LaneMap,
    freeFrames: FreeFrameMap,
    N: number,
  ) => void;
}

/**
 * The single evaluation entry point. Applies all routes, optional expression
 * hooks, then derives Z for every lane. Base writes (drag, preset, op, CSV, LFO)
 * must complete first; renderers sync targets afterwards. Never call per frame.
 */
export function evaluateAll(
  routing: RoutingState,
  lanes: LaneMap,
  N: number,
  hooks?: EvaluateHooks,
  freeFrames?: FreeFrameMap,
): void {
  const laneKeys = laneKeysOf(lanes);
  const freeKeys = freeFrameKeysOf(freeFrames);
  markDelays(routing, laneKeys, freeKeys);
  const order = topoOrderNodes(routing, laneKeys, freeKeys);

  // Sample every delayed source before any write: that snapshot is exactly one
  // evaluation old, and needs no stored state to survive resize or unroute.
  const delayed = new Map<string, Uint8Array>();
  for (const route of routing.routes) {
    if (route.delay) {
      delayed.set(route.id, readSourcePort(lanes, route.from, freeFrames).slice());
    }
  }

  for (const node of order) {
    if (node.kind === "lane") {
      const laneKey = node.key;
      const lane = lanes[laneKey];
      const incoming = routing.routes.filter((r) => !isFreePort(r.to) && r.to.lane === laneKey);

      for (const frame of ["a", "b"] as const) {
        const into = incoming.filter((r) => !isFreePort(r.to) && r.to.frame === frame);
        if (into.length === 0) continue;
        const values = into.map((r) =>
          r.delay ? delayed.get(r.id)! : readSourcePort(lanes, r.from, freeFrames),
        );
        operandReg(lane, frame).bits.set(combine(values, N, into[into.length - 1].mix));
      }

      if (hooks?.applyExpression) {
        for (const frame of ["a", "b"] as const) hooks.applyExpression(laneKey, frame, lanes, N);
      }

      lane.Z.bits = computeZ(lane.A.bits, lane.B.bits, N, lane.binop);
    } else if (freeFrames) {
      const freeKey = node.key;
      const ff = freeFrames[freeKey];
      const into = routing.routes.filter((r) => isFreePort(r.to) && r.to.free === freeKey);
      if (into.length > 0) {
        const values = into.map((r) =>
          r.delay ? delayed.get(r.id)! : readSourcePort(lanes, r.from, freeFrames),
        );
        ff.reg.bits.set(combine(values, N, into[into.length - 1].mix));
      }
      if (hooks?.applyFreeExpression) {
        hooks.applyFreeExpression(freeKey, lanes, freeFrames, N);
      }
    }
  }
}

/** Remap parked bases around a width change so unpatch equals no-route resize. */
export function remapParked(routing: RoutingState, oldN: number, newN: number): void {
  for (const [key, bits] of routing.parked) {
    const values = remapNibbles(bitsToNibbles(bits, oldN), oldN, newN);
    routing.parked.set(key, nibblesToBits(values, newN));
  }
}
