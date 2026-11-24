import type { TracePoint } from "./geometry.ts";

// Review state for one capture. `auto` is what the digitizer produced and is never
// changed; `corrected` starts as a copy and receives every edit; `edits` is the
// append-only log of what the reviewer changed.

export type TraceByLead = Readonly<Record<string, readonly TracePoint[]>>;

export const EDIT_KINDS = ["move", "add", "delete", "reset"] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

export interface TraceEdit {
  seq: number;
  at: string; // ISO timestamp
  lead: string;
  kind: EditKind;
  index: number; // control point index in the corrected lead (-1 for reset)
  before: TracePoint | null;
  after: TracePoint | null;
}

export interface TraceReviewState {
  auto: TraceByLead;
  corrected: TraceByLead;
  edits: readonly TraceEdit[];
}

export type TraceAction =
  | { type: "move"; lead: string; index: number; to: TracePoint; at: string }
  | { type: "add"; lead: string; point: TracePoint; at: string }
  | { type: "delete"; lead: string; index: number; at: string }
  | { type: "reset"; lead: string; at: string };

export function initReview(auto: Record<string, TracePoint[]>): TraceReviewState {
  const frozen: Record<string, readonly TracePoint[]> = {};
  for (const [lead, points] of Object.entries(auto)) {
    frozen[lead] = Object.freeze(points.map((point) => Object.freeze({ ...point })));
  }
  Object.freeze(frozen);
  return { auto: frozen, corrected: frozen, edits: [] };
}

// Keep a moved point between its neighbours so the trace stays a function of time.
function clampBetween(points: readonly TracePoint[], index: number, to: TracePoint): TracePoint {
  const low = index > 0 ? points[index - 1].i + 0.01 : -Infinity;
  const high = index < points.length - 1 ? points[index + 1].i - 0.01 : Infinity;
  return { i: Math.min(high, Math.max(low, to.i)), mv: to.mv };
}

export function insertionIndex(points: readonly TracePoint[], i: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].i < i) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function reviewReducer(state: TraceReviewState, action: TraceAction): TraceReviewState {
  const points = state.corrected[action.lead];
  if (!points) return state;
  const log = (kind: EditKind, index: number, before: TracePoint | null, after: TracePoint | null) =>
    [...state.edits, { seq: state.edits.length + 1, at: action.at, lead: action.lead, kind, index, before, after }];
  const withLead = (next: readonly TracePoint[]) => ({ ...state.corrected, [action.lead]: next });

  switch (action.type) {
    case "move": {
      const before = points[action.index];
      if (!before) return state;
      const after = clampBetween(points, action.index, action.to);
      if (after.i === before.i && after.mv === before.mv) return state;
      const next = points.slice();
      next[action.index] = after;
      return { ...state, corrected: withLead(next), edits: log("move", action.index, before, after) };
    }
    case "add": {
      const index = insertionIndex(points, action.point.i);
      if (points[index]?.i === action.point.i) return state;
      const next = [...points.slice(0, index), action.point, ...points.slice(index)];
      return { ...state, corrected: withLead(next), edits: log("add", index, null, action.point) };
    }
    case "delete": {
      const before = points[action.index];
      if (!before) return state;
      const next = points.filter((_, i) => i !== action.index);
      return { ...state, corrected: withLead(next), edits: log("delete", action.index, before, null) };
    }
    case "reset": {
      if (points === state.auto[action.lead]) return state;
      return { ...state, corrected: withLead(state.auto[action.lead]), edits: log("reset", -1, null, null) };
    }
  }
}

export function editedLeads(state: TraceReviewState): string[] {
  return Object.keys(state.corrected).filter((lead) => state.corrected[lead] !== state.auto[lead]);
}
