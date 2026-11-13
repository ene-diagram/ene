export interface Span {
  line: number;
  col: number;
  length: number;
} // 1-based, in code points
export type Shape = "box" | "round" | "db" | "queue" | "circle";
export const SHAPES: Shape[] = ["box", "round", "db", "queue", "circle"];
export interface NodeDecl {
  id: string;
  label: string;
  icon?: string;
  shape?: Shape;
  color?: string;
  span: Span;
}
export interface Group {
  id: string;
  label: string;
  members: string[];
  parent?: string;
  color?: string;
  span: Span;
}
export type EdgeKind = "ok" | "fail" | "reply" | "async"; // -> | -x | --> | ~>
export interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
  label: string;
  duration?: number;
  span: Span;
}
export type Stmt =
  | { type: "step"; edges: Edge[]; note?: string; span: Span }
  | { type: "wait"; seconds: number; span: Span }
  /** `opt` is a branch with `optional: true` and two arms: the steps (arm 0) and an empty "skip" arm (arm 1) */
  | { type: "branch"; arms: { label: string; body: Stmt[]; span: Span }[]; optional?: boolean; span: Span }
  | { type: "loop"; count: number; body: Stmt[]; span: Span };
export interface Pin {
  id: string;
  col: number;
  row: number;
  span: Span;
}
export interface Rank {
  ids: string[];
  span: Span;
}
/** Flow layout direction: layers go left to right (`right`, default) or top to bottom (`down`) */
export type Direction = "right" | "down";
export const DIRECTIONS: Direction[] = ["right", "down"];
export interface Document {
  kind: "flow" | "sequence";
  /** `direction <name>`: which way a flow diagram runs (unset = right) */
  direction?: Direction;
  title?: string;
  /** `theme <name>`: one of THEMES (unset = default) */
  theme?: string;
  speed: number;
  nodes: Map<string, NodeDecl>;
  body: Stmt[];
  pins: Pin[];
  ranks: Rank[];
  groups: Group[];
}
export type Severity = "error" | "warning";
export interface Diagnostic {
  code: string;
  severity: Severity;
  span: Span;
  args: Record<string, string>;
}
export interface ParseResult {
  doc: Document;
  diagnostics: Diagnostic[];
}

export interface TimelineEdge {
  edgeIndex: number;
  from: string;
  to: string;
  kind: EdgeKind;
  label: string;
  start: number;
  duration: number;
}
export interface TimelineStep {
  index: number;
  start: number;
  duration: number;
  edges: TimelineEdge[];
  branchPath: number[];
  note?: string;
}
export interface Timeline {
  steps: TimelineStep[];
  total: number;
  branches: { label: string; arms: string[]; optional?: boolean }[];
  allEdges: Edge[];
}
