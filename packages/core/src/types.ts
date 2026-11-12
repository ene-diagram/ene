export interface Span { line: number; col: number; length: number } // 1부터, 코드 포인트 기준
export interface NodeDecl { id: string; label: string; icon?: string; span: Span }
export type EdgeKind = "ok" | "fail" | "reply"; // -> | -x | -->
export interface Edge { from: string; to: string; kind: EdgeKind; label: string; duration?: number; span: Span }
export type Stmt =
  | { type: "step"; edges: Edge[]; span: Span }
  | { type: "wait"; seconds: number; span: Span }
  | { type: "branch"; arms: { label: string; body: Stmt[]; span: Span }[]; span: Span }
  | { type: "loop"; count: number; body: Stmt[]; span: Span };
export interface Pin { id: string; col: number; row: number; span: Span }
export interface Rank { ids: string[]; span: Span }
export interface Document {
  title?: string;
  speed: number;
  nodes: Map<string, NodeDecl>;
  body: Stmt[];
  pins: Pin[];
  ranks: Rank[];
}
export type Severity = "error" | "warning";
export interface Diagnostic { code: string; severity: Severity; span: Span; args: Record<string, string> }
export interface ParseResult { doc: Document; diagnostics: Diagnostic[] }

export interface TimelineEdge { edgeIndex: number; from: string; to: string; kind: EdgeKind; label: string; start: number; duration: number }
export interface TimelineStep { index: number; start: number; duration: number; edges: TimelineEdge[]; branchPath: number[] }
export interface Timeline { steps: TimelineStep[]; total: number; branches: { label: string; arms: string[] }[]; allEdges: Edge[] }
