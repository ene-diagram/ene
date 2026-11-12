import { scan, type Line } from "./scan.js";
import { KEYWORDS, suggest, type Code } from "./diagnostics.js";
import { SHAPES, type Shape } from "./types.js";
import type { Diagnostic, Document, Edge, EdgeKind, Group, NodeDecl, ParseResult, Span, Stmt } from "./types.js";

const ID_CHAR = /[\p{L}\p{N}_-]/u;
const NEXT_EDGE = /^\s*[\p{L}\p{N}_-]+?(\[.*?\])?(\{[^}]*\})?\s*(-->|->|-x)(\s|$)/u;
const DURATION = /^(\d+(?:\.\d+)?)s$/;

interface Ref { id: string; label?: string; icon?: string; shape?: Shape; color?: string; start: number; end: number }

export function parse(source: string): ParseResult {
  return new Parser(source).run();
}

type Frame =
  | { kind: "loop"; stmt: Extract<Stmt, { type: "loop" }>; line: Line }
  | { kind: "branch"; stmt: Extract<Stmt, { type: "branch" }>; line: Line; armLine: Line };

class Parser {
  private stack: Frame[] = [];
  private uses = new Map<string, { line: Line; from: number; to: number }[]>();
  private pendingGroups: { g: Group; line: Line; memberAt: { id: string; from: number; to: number }[]; parentAt?: [number, number] }[] = [];
  private hints: { kind: "pin" | "rank"; ids: { id: string; from: number; to: number }[]; line: Line; col?: number; row?: number }[] = [];
  private nodes = new Map<string, NodeDecl>();
  private labeled = new Set<string>();
  private diags: Diagnostic[] = [];
  private doc: Document;

  constructor(private source: string) {
    this.doc = { kind: "flow", speed: 1.2, nodes: this.nodes, body: [], pins: [], ranks: [], groups: [] };
  }

  run(): ParseResult {
    for (const line of scan(this.source)) this.line(line);
    // Report unclosed blocks starting from the outermost (topmost line)
    for (const f of this.stack.splice(0)) {
      if (f.kind === "branch") this.checkArm(f);
      this.report("E203", f.line, 0, [...f.line.text].length, { block: f.kind });
    }
    this.resolveHints();
    this.resolveGroups();
    this.typos();
    if (this.doc.body.length === 0 && !this.diags.some((d) => d.severity === "error"))
      this.diags.push({ code: "E101", severity: "error", span: { line: 1, col: 1, length: 0 }, args: {} });
    return { doc: this.doc, diagnostics: this.diags };
  }

  // ---- diagnostics ----
  span(l: Line, from: number, to: number): Span {
    const col = l.cols[from] ?? (l.cols[l.cols.length - 1] ?? 0) + 1;
    return { line: l.no, col, length: Math.max(1, to - from) };
  }
  report(code: Code, l: Line, from: number, to: number, args: Record<string, string> = {}) {
    if (code === "E102" && args.word && !args.suggestion) {
      const sug = suggest(args.word.split(/\s/, 1)[0], KEYWORDS);
      if (sug) args = { ...args, suggestion: sug };
    }
    this.diags.push({ code, severity: code.startsWith("W") ? "warning" : "error", span: this.span(l, from, to), args });
  }

  // ---- statements ----
  get body(): Stmt[] {
    const f = this.stack[this.stack.length - 1];
    if (!f) return this.doc.body;
    return f.kind === "loop" ? f.stmt.body : f.stmt.arms[f.stmt.arms.length - 1].body;
  }

  checkArm(f: Extract<Frame, { kind: "branch" }>) {
    const arm = f.stmt.arms[f.stmt.arms.length - 1];
    if (arm.body.length === 0) this.report("E201", f.armLine, 0, [...f.armLine.text].length, { arm: arm.label });
  }

  line(l: Line) {
    const into = this.body;
    const t = [...l.text];
    const word = l.text.split(/\s/, 1)[0];
    const rest = l.text.slice(word.length).trim();
    if (word === "title") return void (this.doc.title = rest);
    if (word === "diagram") {
      if (rest !== "flow" && rest !== "sequence") return this.report("E112", l, 8, t.length, { value: rest });
      return void (this.doc.kind = rest);
    }
    if (word === "speed") {
      const n = Number(rest);
      if (!rest || !(n > 0)) return this.report("E304", l, 0, t.length, { value: rest });
      return void (this.doc.speed = n);
    }
    const whole = this.span(l, 0, t.length);
    if (word === "pin" || word === "rank") return this.hint(l, t, word);
    if (word === "group") return this.group(l, t);
    if (word === "end") {
      const f = this.stack.pop();
      if (!f) return this.report("E204", l, 0, 3);
      if (f.kind === "branch") this.checkArm(f);
      return;
    }
    if (word === "wait") {
      const n = Number(rest);
      if (!rest || !(n >= 0)) return this.report("E301", l, 0, t.length, { value: rest });
      return void into.push({ type: "wait", seconds: n, span: whole });
    }
    if (word === "loop") {
      const n = Number(rest);
      if (!Number.isInteger(n) || n < 1) this.report("E302", l, 0, t.length, { value: rest });
      const stmt: Stmt = { type: "loop", count: Number.isInteger(n) && n >= 1 ? n : 1, body: [], span: whole };
      into.push(stmt);
      return void this.stack.push({ kind: "loop", stmt, line: l });
    }
    if (word === "else") {
      const top = this.stack[this.stack.length - 1];
      if (top?.kind !== "branch") return this.report("E205", l, 0, 4);
      this.checkArm(top);
      top.stmt.arms.push({ label: rest, body: [], span: whole });
      top.armLine = l;
      return;
    }
    if (word === "branch") {
      const arm = { label: rest, body: [] as Stmt[], span: whole };
      const stmt: Stmt = { type: "branch", arms: [arm], span: whole };
      into.push(stmt);
      return void this.stack.push({ kind: "branch", stmt, line: l, armLine: l });
    }
    if (t[0] === "&" && /\s/.test(t[1] ?? "")) {
      const prev = into[into.length - 1];
      if (prev?.type !== "step") return this.report("E106", l, 0, 1);
      const cont = this.step(l, t, 2);
      if (cont?.type === "step") prev.edges.push(...cont.edges);
      return;
    }
    const step = this.step(l, t);
    if (step) into.push(step);
  }

  step(l: Line, t: string[], from = 0): Stmt | undefined {
    const s = t.slice(from).join("");
    if (/^&|&$/.test(s.trim()) || /\s&\s+&\s/.test(s)) {
      const at = from + (s.trim().startsWith("&") ? s.indexOf("&") : [...s.slice(0, s.lastIndexOf("&"))].length);
      return void this.report("E106", l, at, at + 1);
    }
    const edges: Edge[] = [];
    let pos = from;
    while (pos < t.length) {
      const r = this.edge(l, t, pos);
      if (!r) return;
      edges.push(r.edge);
      pos = r.next;
    }
    return { type: "step", edges, span: this.span(l, 0, t.length) };
  }

  /** One edge starting at pos. next is the position after the next ` & `, or t.length */
  edge(l: Line, t: string[], pos: number): { edge: Edge; next: number } | undefined {
    const begin = pos = skip(t, pos);
    const a = this.ref(l, t, pos);
    if (a === null) return;
    if (!a) {
      const s = t.slice(pos).join("");
      const ar = arrowAt(t, pos);
      if (ar) return void this.report("E104", l, pos, pos + ar.len);
      const w = s.split(/\s/, 1)[0];
      return void this.report("E102", l, pos, pos + [...w].length, { word: w });
    }
    pos = a.end;
    if (pos < t.length && !/\s/.test(t[pos]) && t[pos] !== "-")
      return void this.report("E107", l, pos, pos + 1, { char: t[pos] });
    pos = skip(t, pos);
    const arrow = arrowAt(t, pos);
    if (!arrow) {
      const w = t.slice(begin).join("").split(/\s/, 1)[0];
      return void this.report("E102", l, begin, begin + [...w].length, { word: w });
    }
    const arrowPos = pos;
    pos = skip(t, pos + arrow.len);
    if (pos >= t.length) return void this.report("E103", l, arrowPos, arrowPos + arrow.len);
    const b = this.ref(l, t, pos);
    if (b === null) return;
    if (!b) return void this.report("E107", l, pos, pos + 1, { char: t[pos] });
    pos = b.end;

    // Cut the remainder before the next edge (` & ref ->`)
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
    for (const r of [a, b]) this.uses.set(r.id, [...(this.uses.get(r.id) ?? []), { line: l, from: r.start, to: r.end }]);
    if (a.id === b.id) this.report("W103", l, begin, pos, { name: a.id });
    const edge: Edge = { from: a.id, to: b.id, kind: arrow.kind, label, span: this.span(l, begin, end) };
    if (duration !== undefined) edge.duration = duration;
    return { edge, next };
  }

  /** undefined = no id, null = error reported */
  ref(l: Line, t: string[], pos: number): Ref | undefined | null {
    if (isArrow(t, pos)) return undefined;
    let i = pos;
    while (i < t.length && ID_CHAR.test(t[i]) && !isArrow(t, i)) i++;
    if (i === pos) return undefined;
    const id = t.slice(pos, i).join("");
    const r: Ref = { id, start: pos, end: i };
    if (t[i] === "[") {
      let depth = 0, closed = false;
      for (let j = i; j < t.length; j++) {
        if (t[j] === "[") depth++;
        else if (t[j] === "]" && --depth === 0) { r.label = t.slice(i + 1, j).join(""); r.end = j + 1; closed = true; break; }
      }
      if (!closed) { this.report("E105", l, i, i + 1); return null; }
    }
    if (t[r.end] === "{") return this.attrs(l, t, r);
    return r;
  }

  /** `{key: value, ...}` node properties. Only icon for now */
  attrs(l: Line, t: string[], r: Ref): Ref | null {
    const open = r.end, close = t.indexOf("}", open);
    if (close < 0) { this.report("E109", l, open, open + 1); return null; }
    let at = open + 1;
    for (const part of t.slice(open + 1, close).join("").split(",")) {
      const len = [...part].length;
      const c = part.indexOf(":");
      const key = (c < 0 ? part : part.slice(0, c)).trim();
      const value = c < 0 ? "" : part.slice(c + 1).trim();
      const vAt = at + (c < 0 ? 0 : [...part.slice(0, c + 1)].length + ([...part.slice(c + 1)].length - [...part.slice(c + 1).trimStart()].length));
      if (key === "icon" && value) r.icon = value;
      else if (key === "shape") {
        if (!SHAPES.includes(value as Shape)) { this.report("E110", l, vAt, vAt + Math.max(1, [...value].length), { value }); return null; }
        r.shape = value as Shape;
      } else if (key === "color") {
        if (!/^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|[a-zA-Z]+)$/.test(value)) { this.report("E111", l, vAt, vAt + Math.max(1, [...value].length), { value }); return null; }
        r.color = value;
      } else if (key) { const k0 = at + [...part].findIndex((ch) => ch.trim()); this.report("E108", l, k0, k0 + [...key].length, { name: key }); return null; }
      at += len + 1;
    }
    r.end = close + 1;
    return r;
  }

  hint(l: Line, t: string[], kind: "pin" | "rank") {
    const ids: { id: string; from: number; to: number }[] = [];
    let pos = skip(t, kind.length);
    while (pos < t.length) {
      const start = pos;
      while (pos < t.length && !/\s/.test(t[pos])) pos++;
      ids.push({ id: t.slice(start, pos).join(""), from: start, to: pos });
      pos = skip(t, pos);
    }
    if (kind === "rank") {
      if (ids.length < 2) return this.report("E102", l, 0, t.length, { word: "rank" });
      return void this.hints.push({ kind, ids, line: l });
    }
    const coord = ids[1]?.id.match(/^(\d+),(\d+)$/);
    if (ids.length !== 2 || !coord) {
      const at = ids[1] ?? { from: t.length, to: t.length };
      return this.report("E402", l, at.from, at.to, { value: ids[1]?.id ?? "" });
    }
    this.hints.push({ kind, ids: [ids[0]], line: l, col: Number(coord[1]), row: Number(coord[2]) });
  }

  /** W101 if an id used only once resembles an earlier declared id */
  typos() {
    const ids = [...this.nodes.keys()];
    ids.forEach((id, i) => {
      const u = this.uses.get(id) ?? [];
      if (u.length !== 1) return;
      const sug = suggest(id, ids.slice(0, i));
      if (sug) this.report("W101", u[0].line, u[0].from, u[0].to, { name: id, suggestion: sug });
    });
  }

  /** group <id>[label]{color: ..} [in <parent>] : <members> ... */
  group(l: Line, t: string[]) {
    // The first ':' outside brackets starts the member list
    let colon = -1;
    for (let i = 0, depth = 0; i < t.length; i++) {
      if (t[i] === "[" || t[i] === "{") depth++;
      else if (t[i] === "]" || t[i] === "}") depth--;
      else if (t[i] === ":" && depth === 0) { colon = i; break; }
    }
    let pos = skip(t, 5);
    const r = this.ref(l, t.slice(0, colon < 0 ? t.length : colon), pos);
    if (r === null) return;
    if (!r || colon < 0) return this.report("E102", l, 0, t.length, { word: "group" });
    const g: Group = { id: r.id, label: r.label ?? r.id, members: [], span: this.span(l, 0, t.length), ...(r.color ? { color: r.color } : {}) };
    pos = skip(t, r.end);
    let parentAt: [number, number] | undefined;
    const head = t.slice(pos, colon).join("").trim();
    if (head) {
      const m = head.match(/^in\s+(\S+)$/);
      if (!m) return this.report("E102", l, pos, colon, { word: head });
      g.parent = m[1];
      const from = pos + [...head].length - [...m[1]].length;
      parentAt = [from, from + [...m[1]].length];
    }
    const memberAt: { id: string; from: number; to: number }[] = [];
    let p = skip(t, colon + 1);
    while (p < t.length) {
      const st = p;
      while (p < t.length && !/\s/.test(t[p])) p++;
      memberAt.push({ id: t.slice(st, p).join(""), from: st, to: p });
      p = skip(t, p);
    }
    if (!memberAt.length) return this.report("E102", l, 0, t.length, { word: "group" });
    this.pendingGroups.push({ g, line: l, memberAt, parentAt });
  }

  resolveGroups() {
    // Filter out duplicate ids first
    const byId = new Map<string, (typeof this.pendingGroups)[number]>();
    for (const pg of this.pendingGroups) {
      if (byId.has(pg.g.id)) { this.report("E405", pg.line, 0, [...pg.line.text].length, { name: pg.g.id }); continue; }
      byId.set(pg.g.id, pg);
    }
    // Order so parents come first (independent of declaration order)
    const ordered: (typeof this.pendingGroups)[number][] = [];
    const state = new Map<string, number>(); // 1 visiting, 2 done
    const visit = (pg: (typeof this.pendingGroups)[number]) => {
      if (state.get(pg.g.id) === 2) return;
      if (state.get(pg.g.id) === 1) return; // cycle — caught below as E406/E404
      state.set(pg.g.id, 1);
      const parent = pg.g.parent ? byId.get(pg.g.parent) : undefined;
      if (parent) visit(parent);
      state.set(pg.g.id, 2);
      ordered.push(pg);
    };
    byId.forEach(visit);

    const memberOf = new Map<string, string>();
    const ok = new Set<string>();
    for (const { g, line, memberAt, parentAt } of ordered) {
      if (g.parent && !ok.has(g.parent)) {
        if (!byId.has(g.parent)) {
          const sug = suggest(g.parent, byId.keys());
          this.report("E406", line, parentAt![0], parentAt![1], sug ? { name: g.parent, suggestion: sug } : { name: g.parent });
        }
        continue;
      }
      let good = true;
      const seen = new Set<string>();
      for (const m of memberAt) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        if (!this.nodes.has(m.id)) {
          const sug = suggest(m.id, this.nodes.keys());
          this.report("E401", line, m.from, m.to, sug ? { name: m.id, suggestion: sug } : { name: m.id });
          good = false; continue;
        }
        const cur = memberOf.get(m.id);
        if (g.parent ? cur !== g.parent : cur !== undefined) { this.report("E404", line, m.from, m.to, { name: m.id, group: g.id }); good = false; }
      }
      if (!good) continue;
      for (const id of seen) { memberOf.set(id, g.id); g.members.push(id); }
      ok.add(g.id);
    }
    // Results go back to the original declaration order
    this.doc.groups = this.pendingGroups.map((pg) => pg.g).filter((g, i, arr) => ok.has(g.id) && arr.findIndex((x) => x.id === g.id) === i);
  }

  resolveHints() {
    const cells = new Map<string, string>();
    for (const h of this.hints) {
      const missing = h.ids.find((x) => !this.nodes.has(x.id));
      if (missing) {
        const sug = suggest(missing.id, this.nodes.keys());
        this.report("E401", h.line, missing.from, missing.to, sug ? { name: missing.id, suggestion: sug } : { name: missing.id });
        continue;
      }
      const span = this.span(h.line, 0, [...h.line.text].length);
      if (h.kind === "rank") { this.doc.ranks.push({ ids: h.ids.map((x) => x.id), span }); continue; }
      const key = `${h.col},${h.row}`, id = h.ids[0].id, other = cells.get(key);
      if (other) {
        this.report("E403", h.line, 0, [...h.line.text].length, { name: id, other, cell: key });
        continue;
      }
      cells.set(key, id);
      this.doc.pins.push({ id, col: h.col!, row: h.row!, span });
    }
  }

  declare(l: Line, r: Ref) {
    const span = this.span(l, r.start, r.end);
    const prev = this.nodes.get(r.id);
    if (prev) for (const k of ["icon", "shape", "color"] as const) if (r[k] && !prev[k]) (prev as unknown as Record<string, unknown>)[k] = r[k];
    if (!prev) {
      this.nodes.set(r.id, { id: r.id, label: r.label ?? r.id, span,
        ...(r.icon ? { icon: r.icon } : {}), ...(r.shape ? { shape: r.shape } : {}), ...(r.color ? { color: r.color } : {}) });
      if (r.label !== undefined) this.labeled.add(r.id);
      return;
    }
    if (r.label === undefined) return;
    if (!this.labeled.has(r.id)) { prev.label = r.label; this.labeled.add(r.id); return; }
    if (prev.label !== r.label) this.report("W102", l, r.start, r.end, { name: r.id, first: prev.label, second: r.label });
  }
}

/**
 * Arrow at position i. `-->` reply, `->` normal, `-x` failure.
 * `-x` only when preceded by whitespace/line start and followed by whitespace/line end (to distinguish from `-x` inside an id)
 */
const arrowAt = (t: string[], i: number): { kind: EdgeKind; len: number } | undefined => {
  if (t[i] !== "-") return;
  if (t[i + 1] === "-" && t[i + 2] === ">") return { kind: "reply", len: 3 };
  if (t[i + 1] === ">") return { kind: "ok", len: 2 };
  if (t[i + 1] === "x" && (i === 0 || /\s/.test(t[i - 1])) && (i + 2 >= t.length || /\s/.test(t[i + 2])))
    return { kind: "fail", len: 2 };
};
const isArrow = (t: string[], i: number) => arrowAt(t, i) !== undefined;
const skip = (t: string[], i: number) => { while (i < t.length && /\s/.test(t[i])) i++; return i; };
