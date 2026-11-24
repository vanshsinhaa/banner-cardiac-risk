import type { TracePoint } from "./geometry.ts";

// Review state for one capture. `auto` is what the digitizer produced and is never
// changed; `corrected` starts as a copy and receives every edit; `edits` is the
// append-only log of what the reviewer changed.

export type TraceByLead = Readonly<Record<string, readonly TracePoint[]>>;

export const EDIT_KINDS = ["move", "add", "delete", "reset", "undo", "redo"] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

export interface TraceEdit {
  seq: number;
  at: string; // ISO timestamp
  lead: string;
  kind: EditKind;
  index: number; // control point index in the corrected lead (-1 for reset/undo/redo)
  before: TracePoint | null;
  after: TracePoint | null;
}

export interface TraceReviewState {
  auto: TraceByLead;
  corrected: TraceByLead;
  edits: readonly TraceEdit[];
  past: readonly TraceByLead[]; // undo stack of earlier corrected traces
  future: readonly TraceByLead[]; // redo stack
}

const HISTORY_LIMIT = 200;

export type TraceAction =
  | { type: "move"; lead: string; index: number; to: TracePoint; at: string }
  | { type: "add"; lead: string; point: TracePoint; at: string }
  | { type: "delete"; lead: string; index: number; at: string }
  | { type: "reset"; lead: string; at: string }
  | { type: "undo"; at: string }
  | { type: "redo"; at: string };

export function initReview(auto: Record<string, TracePoint[]>): TraceReviewState {
  const frozen: Record<string, readonly TracePoint[]> = {};
  for (const [lead, points] of Object.entries(auto)) {
    frozen[lead] = Object.freeze(points.map((point) => Object.freeze({ ...point })));
  }
  Object.freeze(frozen);
  return { auto: frozen, corrected: frozen, edits: [], past: [], future: [] };
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

// The lead whose points differ between two versions of the corrected trace.
function changedLead(a: TraceByLead, b: TraceByLead): string | undefined {
  return Object.keys(a).find((lead) => a[lead] !== b[lead]);
}

function travel(state: TraceReviewState, kind: "undo" | "redo", at: string): TraceReviewState {
  const from = kind === "undo" ? state.past : state.future;
  const target = from[from.length - 1];
  if (!target) return state;
  const lead = changedLead(state.corrected, target) ?? Object.keys(target)[0];
  const rest = from.slice(0, -1);
  const pushed = [...(kind === "undo" ? state.future : state.past), state.corrected];
  return {
    ...state,
    corrected: target,
    past: kind === "undo" ? rest : pushed,
    future: kind === "undo" ? pushed : rest,
    edits: [...state.edits, { seq: state.edits.length + 1, at, lead, kind, index: -1, before: null, after: null }],
  };
}

export function reviewReducer(state: TraceReviewState, action: TraceAction): TraceReviewState {
  if (action.type === "undo" || action.type === "redo") return travel(state, action.type, action.at);
  const changed = applyEdit(state, action);
  if (changed === state) return changed;
  // Every real edit becomes one undo step and clears the redo stack.
  return { ...changed, past: [...state.past, state.corrected].slice(-HISTORY_LIMIT), future: [] };
}

function applyEdit(state: TraceReviewState, action: Exclude<TraceAction, { type: "undo" } | { type: "redo" }>): TraceReviewState {
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
