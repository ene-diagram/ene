import { scan, type Line } from "./scan.js";
import type { Code } from "./diagnostics.js";
import type { Diagnostic, Document, Edge, NodeDecl, ParseResult, Span, Stmt } from "./types.js";

const ID_CHAR = /[\p{L}\p{N}_-]/u;
const NEXT_EDGE = /^\s*[\p{L}\p{N}_-]+(\[.*?\])?\s*(->|-x)(\s|$)/u;
const DURATION = /^(\d+(?:\.\d+)?)s$/;

interface Ref { id: string; label?: string; start: number; end: number }

export function parse(source: string): ParseResult {
  return new Parser(source).run();
}

class Parser {
  private nodes = new Map<string, NodeDecl>();
  private labeled = new Set<string>();
  private diags: Diagnostic[] = [];
  private doc: Document;

  constructor(private source: string) {
    this.doc = { speed: 1.2, nodes: this.nodes, body: [], pins: [], ranks: [] };
  }

  run(): ParseResult {
    for (const line of scan(this.source)) this.line(line, this.doc.body);
    if (this.doc.body.length === 0 && !this.diags.some((d) => d.severity === "error"))
      this.diags.push({ code: "E101", severity: "error", span: { line: 1, col: 1, length: 0 }, args: {} });
    return { doc: this.doc, diagnostics: this.diags };
  }

  // ---- 진단 ----
  span(l: Line, from: number, to: number): Span {
    const col = l.cols[from] ?? (l.cols[l.cols.length - 1] ?? 0) + 1;
    return { line: l.no, col, length: Math.max(1, to - from) };
  }
  report(code: Code, l: Line, from: number, to: number, args: Record<string, string> = {}) {
    this.diags.push({ code, severity: code.startsWith("W") ? "warning" : "error", span: this.span(l, from, to), args });
  }

  // ---- 문장 ----
  line(l: Line, into: Stmt[]) {
    const t = [...l.text];
    const word = l.text.split(/\s/, 1)[0];
    const rest = l.text.slice(word.length).trim();
    if (word === "title") return void (this.doc.title = rest);
    if (word === "speed") {
      const n = Number(rest);
      if (!rest || !(n > 0)) return this.report("E304", l, 0, t.length, { value: rest });
      return void (this.doc.speed = n);
    }
    const step = this.step(l, t);
    if (step) into.push(step);
  }

  step(l: Line, t: string[]): Stmt | undefined {
    const s = t.join("");
    if (/^&|&$/.test(s.trim()) || /\s&\s+&\s/.test(s)) {
      const at = s.trim().startsWith("&") ? 0 : s.lastIndexOf("&");
      return void this.report("E106", l, at, at + 1);
    }
    const edges: Edge[] = [];
    let pos = 0;
    while (pos < t.length) {
      const r = this.edge(l, t, pos);
      if (!r) return;
      edges.push(r.edge);
      pos = r.next;
    }
    return { type: "step", edges, span: this.span(l, 0, t.length) };
  }

  /** pos 부터 엣지 하나. next 는 다음 ` & ` 뒤 위치 또는 t.length */
  edge(l: Line, t: string[], pos: number): { edge: Edge; next: number } | undefined {
    const begin = pos = skip(t, pos);
    const a = this.ref(l, t, pos);
    if (a === null) return;
    if (!a) {
      const s = t.slice(pos).join("");
      if (/^(->|-x)/.test(s)) return void this.report("E104", l, pos, pos + 2);
      const w = s.split(/\s/, 1)[0];
      return void this.report("E102", l, pos, pos + [...w].length, { word: w });
    }
    pos = a.end;
    if (pos < t.length && !/\s/.test(t[pos]) && t[pos] !== "-")
      return void this.report("E107", l, pos, pos + 1, { char: t[pos] });
    pos = skip(t, pos);
    const arrow = t.slice(pos, pos + 2).join("");
    if (!isArrow(t, pos)) {
      const w = t.slice(begin).join("").split(/\s/, 1)[0];
      return void this.report("E102", l, begin, begin + [...w].length, { word: w });
    }
    const arrowAt = pos;
    pos = skip(t, pos + 2);
    if (pos >= t.length) return void this.report("E103", l, arrowAt, arrowAt + 2);
    const b = this.ref(l, t, pos);
    if (b === null) return;
    if (!b) return void this.report("E107", l, pos, pos + 1, { char: t[pos] });
    pos = b.end;

    // 남은 부분을 다음 엣지(` & ref ->`) 앞에서 자른다
    let end = t.length, next = t.length;
    for (let i = pos; i + 2 < t.length; i++) {
      if (t[i] === " " && t[i + 1] === "&" && t[i + 2] === " " && NEXT_EDGE.test(t.slice(i + 3).join(""))) {
        end = i; next = i + 3; break;
      }
    }
    let tail = t.slice(pos, end).join("");
    let duration: number | undefined;
    const dm = tail.match(/(^|\s)@(\S+)\s*$/);
    if (dm) {
      const at = pos + [...tail.slice(0, dm.index! + dm[1].length)].length;
      const v = dm[2].match(DURATION);
      if (!v) return void this.report("E303", l, at, at + 1 + [...dm[2]].length, { value: dm[2] });
      duration = Number(v[1]);
      tail = tail.slice(0, dm.index);
    }
    let label = "";
    const tt = tail.trim();
    if (tt.startsWith(":")) label = tt.slice(1).trim();
    else if (tt) {
      const at = skip(t, pos);
      return void this.report("E102", l, at, at + [...tt].length, { word: tt });
    }
    this.declare(l, a);
    this.declare(l, b);
    const edge: Edge = { from: a.id, to: b.id, kind: arrow === "-x" ? "fail" : "ok", label, span: this.span(l, begin, end) };
    if (duration !== undefined) edge.duration = duration;
    return { edge, next };
  }

  /** undefined = id 없음, null = 오류 보고함 */
  ref(l: Line, t: string[], pos: number): Ref | undefined | null {
    if (isArrow(t, pos)) return undefined;
    let i = pos;
    while (i < t.length && ID_CHAR.test(t[i]) && !isArrow(t, i)) i++;
    if (i === pos) return undefined;
    const id = t.slice(pos, i).join("");
    if (t[i] !== "[") return { id, start: pos, end: i };
    let depth = 0;
    for (let j = i; j < t.length; j++) {
      if (t[j] === "[") depth++;
      else if (t[j] === "]" && --depth === 0) return { id, label: t.slice(i + 1, j).join(""), start: pos, end: j + 1 };
    }
    this.report("E105", l, i, i + 1);
    return null;
  }

  declare(l: Line, r: Ref) {
    const span = this.span(l, r.start, r.end);
    const prev = this.nodes.get(r.id);
    if (!prev) {
      this.nodes.set(r.id, { id: r.id, label: r.label ?? r.id, span });
      if (r.label !== undefined) this.labeled.add(r.id);
      return;
    }
    if (r.label === undefined) return;
    if (!this.labeled.has(r.id)) { prev.label = r.label; this.labeled.add(r.id); return; }
    if (prev.label !== r.label) this.report("W102", l, r.start, r.end, { name: r.id, first: prev.label, second: r.label });
  }
}

/** `->`, 또는 앞이 공백·줄 시작이고 뒤가 공백·줄 끝인 `-x` (id 안의 `-x` 와 구분) */
const isArrow = (t: string[], i: number) =>
  t[i] === "-" && (t[i + 1] === ">" ||
    (t[i + 1] === "x" && (i === 0 || /\s/.test(t[i - 1])) && (i + 2 >= t.length || /\s/.test(t[i + 2]))));
const skip = (t: string[], i: number) => { while (i < t.length && /\s/.test(t[i])) i++; return i; };
