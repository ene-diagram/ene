import { scan, type Line } from "./scan.js";
import { KEYWORDS, suggest, type Code } from "./diagnostics.js";
import { THEMES, isTheme } from "./themes.js";
import { SHAPES, type Shape } from "./types.js";
import type { Diagnostic, Document, Edge, EdgeKind, Group, NodeDecl, ParseResult, Span, Stmt } from "./types.js";

const ID_CHAR = /[\p{L}\p{N}_-]/u;
const NEXT_EDGE = /^\s*[\p{L}\p{N}_-]+?(\[.*?\])?(\{[^}]*\})?\s*(-->|->|-x|~>)(\s|$)/u;
const DURATION = /^(\d+(?:\.\d+)?)s$/;

/** Limits that keep untrusted input from exhausting CPU/memory */
export const LIMITS = { depth: 32, steps: 10_000, seconds: 86_400 };

/** CSS named colors (CSS Color Module Level 4) plus transparent / currentColor */
const CSS_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
    "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey " +
    "darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey " +
    "darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
    "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon " +
    "lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue " +
    "lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid " +
    "mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin " +
    "navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff " +
    "peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver " +
    "skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow " +
    "yellowgreen transparent currentcolor"
  ).split(" "),
);
const isColor = (v: string) =>
  /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) || CSS_COLORS.has(v.toLowerCase());

interface Ref {
  id: string;
  label?: string;
  icon?: string;
  shape?: Shape;
  color?: string;
  start: number;
  end: number;
}

/** `#` that reads like a comment (whitespace on both sides) and `@2s` that reads like a duration, inside a label */
const LABEL_HASH = /(?:^|\s)(#)(?:\s|$)/;
const LABEL_DURATION = /(?:^|\s)@(\d+(?:\.\d+)?s)(?:\s|$)/;

/** Text of an included file, and the name it is known by (for messages, loops and its own includes) */
export interface IncludeResult {
  source: string;
  file: string;
}
/**
 * Reads the file named on an `include` line. `from` is the file that has the line (`ParseOptions.file` for the
 * root source). Synchronous on purpose: parsing stays a plain function call.
 */
export type Includer = (path: string, from: string | undefined) => IncludeResult | { error: string };
export interface ParseOptions {
  /** Without it an `include` line is an error (`E501`), which is what the browser player wants */
  include?: Includer;
  /** Name of the source being parsed, passed to `include` as `from` */
  file?: string;
}
/** Most levels of `include` inside `include` */
export const INCLUDE_DEPTH = 8;

export function parse(source: string, opts: ParseOptions = {}): ParseResult {
  return new Parser(source, opts).run();
}

/** What an included file contributes: declarations only */
interface Library {
  nodes: Map<string, NodeDecl>;
  labeled: Set<string>;
  groups: Group[];
  pins: Document["pins"];
  ranks: Document["ranks"];
  theme?: string;
  speed?: number;
  diagnostics: Diagnostic[];
}

type Frame =
  | { kind: "loop"; stmt: Extract<Stmt, { type: "loop" }>; line: Line }
  | { kind: "branch"; stmt: Extract<Stmt, { type: "branch" }>; line: Line; armLine: Line };

class Parser {
  private stack: Frame[] = [];
  private uses = new Map<string, { line: Line; from: number; to: number }[]>();
  private pendingGroups: {
    g: Group;
    line: Line;
    memberAt: { id: string; from: number; to: number }[];
    parentAt?: [number, number];
  }[] = [];
  private hints: {
    kind: "pin" | "rank";
    ids: { id: string; from: number; to: number }[];
    line: Line;
    col?: number;
    row?: number;
  }[] = [];
  private nodes = new Map<string, NodeDecl>();
  private labeled = new Set<string>();
  private settings = new Set<string>();
  private layoutLines: { keyword: string; line: Line }[] = [];
  private diags: Diagnostic[] = [];
  private doc: Document;
  /** A node, step or layout line has been read: `include` is no longer allowed */
  private started = false;
  /** Declarations from included files. A node is taken from here the first time this file uses it */
  private catalog = {
    nodes: new Map<string, NodeDecl>(),
    labeled: new Set<string>(),
    groups: [] as Group[],
    pins: [] as Document["pins"],
    ranks: [] as Document["ranks"],
  };

  constructor(
    private source: string,
    private opts: ParseOptions = {},
    /** Set when this source is an included file: its name and the files that led to it */
    private lib?: { file: string; chain: string[] },
  ) {
    this.doc = { kind: "flow", speed: 1.2, nodes: this.nodes, body: [], pins: [], ranks: [], groups: [] };
  }

  run(): ParseResult {
    for (const line of scan(this.source)) this.line(line);
    // Report unclosed blocks starting from the outermost (topmost line)
    for (const f of this.stack.splice(0)) {
      this.close(f);
      this.report("E203", f.line, 0, [...f.line.text].length, {
        block: f.kind === "branch" && f.stmt.optional ? "opt" : f.kind,
      });
    }
    this.resolveHints();
    this.resolveGroups();
    this.mergeCatalog();
    // W111: layout hints and groups are dropped by the sequence layout
    if (this.doc.kind === "sequence")
      for (const { keyword, line } of this.layoutLines) this.report("W111", line, 0, keyword.length, { keyword });
    this.typos();
    if (!this.diags.some((d) => d.severity === "error")) this.budget();
    if (this.doc.body.length === 0 && !this.diags.some((d) => d.severity === "error"))
      this.diags.push({ code: "E101", severity: "error", span: { line: 1, col: 1, length: 0 }, args: {} });
    return { doc: this.doc, diagnostics: this.diags };
  }

  /** Parse as an included file: only declarations are allowed, and every one of them is handed up */
  runLibrary(): Library {
    for (const line of scan(this.source)) this.line(line);
    // Everything from nested includes is part of this library, used here or not
    for (const id of this.catalog.nodes.keys()) this.adopt(id);
    this.resolveHints();
    this.resolveGroups();
    this.mergeCatalog();
    return {
      nodes: this.nodes,
      labeled: this.labeled,
      groups: this.doc.groups,
      pins: this.doc.pins,
      ranks: this.doc.ranks,
      ...(this.doc.theme ? { theme: this.doc.theme } : {}),
      ...(this.speedSet ? { speed: this.doc.speed } : {}),
      diagnostics: this.diags,
    };
  }
  private speedSet = false;

  /** `include <path>`: read the file as a library and keep its declarations for later use */
  include(l: Line, t: string[], rest: string) {
    if (!rest) return this.report("E307", l, 0, t.length, { keyword: "include", example: "include ./system.ene" });
    const at = skip(t, 7);
    if (this.started) return this.report("E504", l, 0, t.length);
    if (!this.opts.include) return this.report("E501", l, 0, t.length);
    const chain = this.lib?.chain ?? (this.opts.file !== undefined ? [this.opts.file] : []);
    const r = this.opts.include(rest, this.lib?.file ?? this.opts.file);
    if ("error" in r) return this.report("E502", l, at, t.length, { path: rest, reason: r.error });
    if (chain.includes(r.file) || chain.length >= INCLUDE_DEPTH + (this.opts.file !== undefined ? 1 : 0))
      return this.report("E505", l, at, t.length, { path: rest, limit: String(INCLUDE_DEPTH) });
    const sub = new Parser(r.source, this.opts, { file: r.file, chain: [...chain, r.file] }).runLibrary();
    // Each level re-points `at`, so the root ends up with its own `include` line
    const here = this.span(l, 0, t.length);
    this.diags.push(...sub.diagnostics.map((d) => ({ ...d, at: here })));
    // The first declaration of an id wins, as inside one file
    for (const [id, n] of sub.nodes)
      if (!this.catalog.nodes.has(id)) {
        this.catalog.nodes.set(id, n);
        if (sub.labeled.has(id)) this.catalog.labeled.add(id);
      }
    this.catalog.groups.push(...sub.groups);
    this.catalog.pins.push(...sub.pins);
    this.catalog.ranks.push(...sub.ranks);
    // Settings from an include are defaults: a `theme` / `speed` line in this file replaces them
    if (sub.theme && !this.doc.theme) this.doc.theme = sub.theme;
    if (sub.speed !== undefined && !this.speedSet) {
      this.doc.speed = sub.speed;
      this.speedSet = true;
    }
  }

  /** Take a node from the catalog the first time it is used here */
  adopt(id: string): NodeDecl | undefined {
    const have = this.nodes.get(id);
    if (have) return have;
    const c = this.catalog.nodes.get(id);
    if (!c) return undefined;
    const n = { ...c };
    this.nodes.set(id, n);
    if (this.catalog.labeled.has(id)) this.labeled.add(id);
    return n;
  }

  /**
   * Groups, pins and ranks from included files, cut down to the nodes this file uses. What this file says
   * itself wins: its groups keep their nodes, its pins keep their cells.
   */
  mergeCatalog() {
    const used = (id: string) => this.nodes.has(id);
    const ownIds = new Set(this.doc.groups.map((g) => g.id));
    const taken = new Set(this.doc.groups.flatMap((g) => g.members));
    // Several files may group the same node. As inside one file, a node sits in one chain of nested groups:
    // a top-level group takes nodes no group has yet, a nested group takes nodes of its parent. The first
    // file to group a node wins; parents are placed before their children whatever the order in the files.
    const byId = new Map<string, Group>();
    for (const g of this.catalog.groups) if (!ownIds.has(g.id) && !byId.has(g.id)) byId.set(g.id, g);
    const innermost = new Map<string, string>();
    const alive = new Map<string, Group>();
    const place = (g: Group, seen: Set<string>) => {
      if (alive.has(g.id) || seen.has(g.id)) return;
      seen.add(g.id);
      if (g.parent !== undefined) {
        const parent = byId.get(g.parent);
        if (parent) place(parent, seen);
        // Without its parent (an id clash, or the parent kept no node) a nested group is dropped
        if (!alive.has(g.parent)) return;
      }
      const members = g.members.filter(
        (m) => used(m) && !taken.has(m) && (g.parent !== undefined ? innermost.get(m) === g.parent : !innermost.has(m)),
      );
      if (!members.length) return;
      for (const m of members) innermost.set(m, g.id);
      alive.set(g.id, { ...g, members });
    };
    for (const g of byId.values()) place(g, new Set());
    // Declaration order, as for the diagram's own groups
    this.doc.groups.push(...[...byId.keys()].flatMap((id) => alive.get(id) ?? []));
    for (const p of this.catalog.pins)
      if (used(p.id) && !this.doc.pins.some((q) => q.id === p.id || (q.col === p.col && q.row === p.row)))
        this.doc.pins.push(p);
    for (const r of this.catalog.ranks) {
      const ids = r.ids.filter(used);
      if (ids.length >= 2) this.doc.ranks.push({ ...r, ids });
    }
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
    this.diags.push({
      code,
      severity: code.startsWith("W") ? "warning" : "error",
      span: this.span(l, from, to),
      args,
      ...(this.lib ? { file: this.lib.file, lineText: l.text } : {}),
    });
  }

  depthCheck(l: Line) {
    if (this.stack.length === LIMITS.depth)
      this.report("E206", l, 0, [...l.text].length, { limit: String(LIMITS.depth) });
  }

  /** E305/E306: worst-case expanded steps and duration over any branch path, without expanding */
  budget() {
    const cost = (body: Stmt[]): { steps: number; secs: number } => {
      let steps = 0,
        secs = 0;
      for (const s of body) {
        if (s.type === "wait") secs += s.seconds;
        else if (s.type === "step") {
          steps++;
          secs += Math.max(...s.edges.map((e) => e.duration ?? this.doc.speed));
        } else if (s.type === "loop") {
          const c = cost(s.body);
          steps += c.steps * s.count;
          secs += c.secs * s.count;
        } else {
          const cs = s.arms.map((a) => cost(a.body));
          steps += Math.max(...cs.map((c) => c.steps));
          secs += Math.max(...cs.map((c) => c.secs));
        }
      }
      return { steps, secs };
    };
    const c = cost(this.doc.body);
    const at: Span = { line: 1, col: 1, length: 1 };
    if (c.steps > LIMITS.steps)
      this.diags.push({ code: "E305", severity: "error", span: at, args: { limit: String(LIMITS.steps) } });
    else if (!(c.secs <= LIMITS.seconds))
      this.diags.push({ code: "E306", severity: "error", span: at, args: { limit: String(LIMITS.seconds) } });
  }

  // ---- statements ----
  get body(): Stmt[] {
    const f = this.stack[this.stack.length - 1];
    if (!f) return this.doc.body;
    return f.kind === "loop" ? f.stmt.body : f.stmt.arms[f.stmt.arms.length - 1].body;
  }

  /** Closing a block: the last arm needs a step; `opt` gets its empty "skip" arm */
  close(f: Frame) {
    if (f.kind !== "branch") return;
    this.checkArm(f);
    if (f.stmt.optional) f.stmt.arms.push({ label: "skip", body: [], span: f.stmt.span });
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
    // A keyword followed by an arrow is almost always a node named like the keyword
    if (KEYWORDS.includes(word) && arrowAt([...rest], 0)) {
      if (word !== "title" && word !== "branch" && word !== "else")
        return this.report("E115", l, 0, word.length, { keyword: word });
      this.report("W109", l, 0, word.length, { keyword: word });
    }
    if (word === "title" || word === "diagram" || word === "speed" || word === "theme") {
      if (this.settings.has(word)) this.report("W107", l, 0, word.length, { keyword: word });
      this.settings.add(word);
    }
    if (word === "include") return this.include(l, t, rest);
    if (this.lib && !["group", "pin", "rank", "theme", "speed"].includes(word)) {
      // An included file: besides those lines, only node declarations
      this.started = true;
      if (!this.nodeLine(l, t)) this.report("E503", l, 0, t.length);
      return;
    }
    if (word === "title") {
      this.labelHash(l, t, word.length, t.length);
      this.doc.title = rest;
      return;
    }
    if (word === "diagram") {
      if (rest !== "flow" && rest !== "sequence") return this.report("E112", l, 8, t.length, { value: rest });
      this.doc.kind = rest;
      return;
    }
    const EXAMPLES: Record<string, string> = {
      speed: "speed 1.2",
      wait: "wait 0.5",
      loop: "loop 3",
      theme: "theme mono",
      note: "note Cache is checked first",
    };
    if (!rest && word in EXAMPLES)
      return this.report("E307", l, 0, t.length, { keyword: word, example: EXAMPLES[word] });
    if (word === "theme") {
      if (!isTheme(rest)) {
        const suggestion = suggest(rest, [...THEMES]);
        return this.report("E118", l, 6, t.length, {
          value: rest,
          themes: THEMES.join(", "),
          ...(suggestion ? { suggestion } : {}),
        });
      }
      this.doc.theme = rest;
      return;
    }
    if (word === "note") {
      // Attaches to the closest step above it in the same block (a `wait` in between is fine)
      let k = into.length - 1;
      while (k >= 0 && into[k].type === "wait") k--;
      const prev = into[k];
      if (prev?.type !== "step") return this.report("E116", l, 0, 4);
      this.labelHash(l, t, word.length, t.length);
      prev.note = prev.note === undefined ? rest : `${prev.note} ${rest}`;
      return;
    }
    if (word === "speed") {
      const n = Number(rest);
      if (!rest || !(n > 0) || !Number.isFinite(n)) return this.report("E304", l, 0, t.length, { value: rest });
      this.doc.speed = n;
      this.speedSet = true;
      return;
    }
    this.started = true;
    const whole = this.span(l, 0, t.length);
    if (word === "pin" || word === "rank" || word === "group") this.layoutLines.push({ keyword: word, line: l });
    if (word === "pin" || word === "rank") return this.hint(l, t, word);
    if (word === "group") return this.group(l, t);
    if (word === "end") {
      if (rest) {
        const at = skip(t, 3);
        this.report("W108", l, at, t.length, { word: rest });
      }
      const f = this.stack.pop();
      if (!f) return this.report("E204", l, 0, 3);
      return this.close(f);
    }
    if (word === "wait") {
      const n = Number(rest);
      if (!rest || !(n >= 0) || !Number.isFinite(n)) return this.report("E301", l, 0, t.length, { value: rest });
      return void into.push({ type: "wait", seconds: n, span: whole });
    }
    if (word === "loop") {
      const n = Number(rest);
      const okCount = Number.isSafeInteger(n) && n >= 1;
      if (!okCount) this.report("E302", l, 0, t.length, { value: rest });
      const stmt: Stmt = { type: "loop", count: okCount ? n : 1, body: [], span: whole };
      into.push(stmt);
      this.depthCheck(l);
      return void this.stack.push({ kind: "loop", stmt, line: l });
    }
    if (word === "else") {
      const top = this.stack[this.stack.length - 1];
      if (top?.kind !== "branch" || top.stmt.optional) return this.report("E205", l, 0, 4);
      this.checkArm(top);
      this.labelHash(l, t, word.length, t.length);
      top.stmt.arms.push({ label: rest, body: [], span: whole });
      top.armLine = l;
      return;
    }
    if (word === "branch" || word === "opt") {
      this.labelHash(l, t, word.length, t.length);
      const arm = { label: rest, body: [] as Stmt[], span: whole };
      const stmt: Extract<Stmt, { type: "branch" }> = { type: "branch", arms: [arm], span: whole };
      if (word === "opt") stmt.optional = true;
      into.push(stmt);
      this.depthCheck(l);
      return void this.stack.push({ kind: "branch", stmt, line: l, armLine: l });
    }
    if (t[0] === "&" && /\s/.test(t[1] ?? "")) {
      const prev = into[into.length - 1];
      if (prev?.type !== "step") return this.report("E106", l, 0, 1);
      const cont = this.step(l, t, 2);
      if (cont?.type === "step") prev.edges.push(...cont.edges);
      return;
    }
    if (this.nodeLine(l, t)) return;
    const step = this.step(l, t);
    if (step) into.push(step);
  }

  /** W105: a `#` with whitespace around it inside a label or title is kept as text */
  labelHash(l: Line, t: string[], from: number, to: number) {
    const m = t.slice(from, to).join("").match(LABEL_HASH);
    if (!m) return;
    const at =
      from +
      [
        ...t
          .slice(from, to)
          .join("")
          .slice(0, m.index! + m[0].indexOf("#")),
      ].length;
    this.report("W105", l, at, at + 1);
  }

  /**
   * A line that is only `id[Label]` / `id{attrs}` declares a node without an edge.
   * A bare `id` is not a declaration, so a mistyped keyword still reports E102.
   */
  nodeLine(l: Line, t: string[]): boolean {
    if (!/^[\p{L}\p{N}_-]+[[{]/u.test(l.text)) return false;
    const r = this.ref(l, t, 0);
    if (r === null) return true; // ref() reported the error
    if (!r || skip(t, r.end) < t.length) return false;
    this.declare(l, r);
    this.uses.set(r.id, [...(this.uses.get(r.id) ?? []), { line: l, from: r.start, to: r.end }]);
    return true;
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
    pos = skip(t, pos);
    const begin = pos;
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
    if (t[pos] === "~" && t[pos + 1] === ">") return void this.report("E117", l, pos, pos + 2);
    if (pos < t.length && !/\s/.test(t[pos]) && t[pos] !== "-")
      return void this.report("E107", l, pos, pos + 1, { char: t[pos] });
    pos = skip(t, pos);
    const arrow = arrowAt(t, pos);
    if (!arrow) {
      // `a-x b` (glued to the source) or `a -xb` (glued to the target)
      if (
        a.label === undefined &&
        a.id.length > 2 &&
        a.id.endsWith("-x") &&
        a.end === a.start + [...a.id].length &&
        pos > a.end &&
        pos < t.length &&
        ID_CHAR.test(t[pos])
      )
        return void this.report("E113", l, a.end - 2, a.end);
      if (t[pos] === "-" && t[pos + 1] === "x" && pos > a.end) return void this.report("E113", l, pos, pos + 2);
      const w = t.slice(begin).join("").split(/\s/, 1)[0];
      return void this.report("E102", l, begin, begin + [...w].length, { word: w });
    }
    const arrowPos = pos;
    if (arrow.kind === "async" && pos + 2 < t.length && !/\s/.test(t[pos + 2]))
      return void this.report("E117", l, pos, pos + 2);
    pos = skip(t, pos + arrow.len);
    if (pos >= t.length) return void this.report("E103", l, arrowPos, arrowPos + arrow.len);
    const b = this.ref(l, t, pos);
    if (b === null) return;
    if (!b) return void this.report("E107", l, pos, pos + 1, { char: t[pos] });
    pos = b.end;

    // Cut the remainder before the next edge (` & ref ->`)
    let end = t.length,
      next = t.length;
    for (let i = pos; i + 2 < t.length; i++) {
      if (t[i] === " " && t[i + 1] === "&" && t[i + 2] === " " && NEXT_EDGE.test(t.slice(i + 3).join(""))) {
        end = i;
        next = i + 3;
        break;
      }
    }
    let tail = t.slice(pos, end).join("");
    let duration: number | undefined;
    const dm = tail.match(/(^|\s)@(\S+)\s*$/);
    if (dm) {
      const at = pos + [...tail.slice(0, dm.index! + dm[1].length)].length;
      const v = dm[2].match(DURATION);
      if (!v || !Number.isFinite(Number(v[1])))
        return void this.report("E303", l, at, at + 1 + [...dm[2]].length, { value: dm[2] });
      duration = Number(v[1]);
      tail = tail.slice(0, dm.index);
    }
    let label = "";
    const tt = tail.trim();
    if (tt.startsWith(":")) {
      label = tt.slice(1).trim();
      const labelFrom = skip(t, pos) + 1,
        labelTo = labelFrom + [...tt.slice(1)].length;
      this.labelHash(l, t, labelFrom, labelTo);
      const lm = label.match(LABEL_DURATION);
      if (lm) {
        const off =
          [...tt.slice(1)].length -
          [...tt.slice(1).trimStart()].length +
          [...label.slice(0, lm.index! + lm[0].indexOf("@"))].length;
        this.report("W110", l, labelFrom + off, labelFrom + off + 1 + [...lm[1]].length, { value: lm[1] });
      }
    } else if (tt) {
      const at = skip(t, pos);
      return void this.report("E102", l, at, at + [...tt].length, { word: tt });
    }
    this.declare(l, a);
    this.declare(l, b);
    for (const r of [a, b])
      this.uses.set(r.id, [...(this.uses.get(r.id) ?? []), { line: l, from: r.start, to: r.end }]);
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
      let depth = 0,
        closed = false;
      for (let j = i; j < t.length; j++) {
        if (t[j] === "[") depth++;
        else if (t[j] === "]" && --depth === 0) {
          r.label = t.slice(i + 1, j).join("");
          r.end = j + 1;
          closed = true;
          break;
        }
      }
      if (!closed) {
        this.report("E105", l, i, i + 1);
        return null;
      }
    }
    if (t[r.end] === "{") return this.attrs(l, t, r);
    return r;
  }

  /** `{key: value, ...}` node properties. Only icon for now */
  attrs(l: Line, t: string[], r: Ref): Ref | null {
    const open = r.end,
      close = t.indexOf("}", open);
    if (close < 0) {
      this.report("E109", l, open, open + 1);
      return null;
    }
    let at = open + 1;
    for (const part of t
      .slice(open + 1, close)
      .join("")
      .split(",")) {
      const len = [...part].length;
      const c = part.indexOf(":");
      const key = (c < 0 ? part : part.slice(0, c)).trim();
      const value = c < 0 ? "" : part.slice(c + 1).trim();
      const vAt =
        at +
        (c < 0
          ? 0
          : [...part.slice(0, c + 1)].length +
            ([...part.slice(c + 1)].length - [...part.slice(c + 1).trimStart()].length));
      if ((key === "icon" || key === "shape" || key === "color") && !value) {
        const k0 =
          at +
          Math.max(
            0,
            [...part].findIndex((ch) => ch.trim()),
          );
        this.report("E114", l, k0, k0 + [...key].length, { name: key });
        return null;
      }
      if (key === "icon") r.icon = value;
      else if (key === "shape") {
        if (!SHAPES.includes(value as Shape)) {
          this.report("E110", l, vAt, vAt + Math.max(1, [...value].length), { value });
          return null;
        }
        r.shape = value as Shape;
      } else if (key === "color") {
        if (!isColor(value)) {
          const sug = /^[a-zA-Z]+$/.test(value) ? suggest(value.toLowerCase(), CSS_COLORS) : undefined;
          this.report(
            "E111",
            l,
            vAt,
            vAt + Math.max(1, [...value].length),
            sug ? { value, suggestion: sug } : { value },
          );
          return null;
        }
        r.color = value;
      } else if (key) {
        const k0 = at + [...part].findIndex((ch) => ch.trim());
        this.report("E108", l, k0, k0 + [...key].length, { name: key });
        return null;
      }
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
      // An id declared in an included file is not a typo
      if (u.length !== 1 || this.catalog.nodes.has(id)) return;
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
      else if (t[i] === ":" && depth === 0) {
        colon = i;
        break;
      }
    }
    let pos = skip(t, 5);
    const r = this.ref(l, t.slice(0, colon < 0 ? t.length : colon), pos);
    if (r === null) return;
    if (!r || colon < 0) return this.report("E102", l, 0, t.length, { word: "group" });
    const g: Group = {
      id: r.id,
      label: r.label ?? r.id,
      members: [],
      span: this.span(l, 0, t.length),
      ...(r.color ? { color: r.color } : {}),
    };
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
      if (byId.has(pg.g.id)) {
        this.report("E405", pg.line, 0, [...pg.line.text].length, { name: pg.g.id });
        continue;
      }
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

    const inCycle = (id: string) => {
      const seen = new Set<string>();
      for (let cur = byId.get(id)?.g.parent; cur !== undefined && !seen.has(cur); cur = byId.get(cur)?.g.parent) {
        if (cur === id) return true;
        seen.add(cur);
      }
      return false;
    };
    const memberOf = new Map<string, string>();
    const ok = new Set<string>();
    for (const { g, line, memberAt, parentAt } of ordered) {
      if (g.parent && !ok.has(g.parent)) {
        if (inCycle(g.id)) this.report("E407", line, parentAt![0], parentAt![1], { name: g.id });
        else if (!byId.has(g.parent)) {
          const sug = suggest(g.parent, byId.keys());
          this.report(
            "E406",
            line,
            parentAt![0],
            parentAt![1],
            sug ? { name: g.parent, suggestion: sug } : { name: g.parent },
          );
        }
        continue;
      }
      let good = true;
      const seen = new Set<string>();
      for (const m of memberAt) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        this.adopt(m.id);
        if (!this.nodes.has(m.id)) {
          const sug = suggest(m.id, this.nodes.keys());
          this.report("E401", line, m.from, m.to, sug ? { name: m.id, suggestion: sug } : { name: m.id });
          good = false;
          continue;
        }
        const cur = memberOf.get(m.id);
        if (g.parent ? cur !== g.parent : cur !== undefined) {
          this.report("E404", line, m.from, m.to, { name: m.id, group: g.id });
          good = false;
        }
      }
      if (!good) continue;
      for (const id of seen) {
        memberOf.set(id, g.id);
        g.members.push(id);
      }
      ok.add(g.id);
    }
    // Results go back to the original declaration order
    this.doc.groups = this.pendingGroups
      .map((pg) => pg.g)
      .filter((g, i, arr) => ok.has(g.id) && arr.findIndex((x) => x.id === g.id) === i);
  }

  resolveHints() {
    const cells = new Map<string, string>();
    for (const h of this.hints) {
      for (const x of h.ids) this.adopt(x.id);
      const missing = h.ids.find((x) => !this.nodes.has(x.id));
      if (missing) {
        const sug = suggest(missing.id, this.nodes.keys());
        this.report(
          "E401",
          h.line,
          missing.from,
          missing.to,
          sug ? { name: missing.id, suggestion: sug } : { name: missing.id },
        );
        continue;
      }
      const span = this.span(h.line, 0, [...h.line.text].length);
      if (h.kind === "rank") {
        this.doc.ranks.push({ ids: h.ids.map((x) => x.id), span });
        continue;
      }
      const key = `${h.col},${h.row}`,
        id = h.ids[0].id,
        other = cells.get(key);
      if (other) {
        this.report("E403", h.line, 0, [...h.line.text].length, { name: id, other, cell: key });
        continue;
      }
      cells.set(key, id);
      if (this.doc.pins.some((p) => p.id === id)) this.report("W112", h.line, h.ids[0].from, h.ids[0].to, { name: id });
      this.doc.pins.push({ id, col: h.col!, row: h.row!, span });
    }
  }

  declare(l: Line, r: Ref) {
    const span = this.span(l, r.start, r.end);
    const prev = this.adopt(r.id);
    if (prev)
      for (const k of ["icon", "shape", "color"] as const) {
        if (r[k] && !prev[k]) (prev as unknown as Record<string, unknown>)[k] = r[k];
        else if (r[k] && prev[k] !== r[k])
          this.report("W106", l, r.start, r.end, { name: r.id, attr: k, first: prev[k]!, second: r[k]! });
      }
    if (!prev) {
      this.nodes.set(r.id, {
        id: r.id,
        label: r.label ?? r.id,
        span,
        ...(r.icon ? { icon: r.icon } : {}),
        ...(r.shape ? { shape: r.shape } : {}),
        ...(r.color ? { color: r.color } : {}),
      });
      if (r.label !== undefined) this.labeled.add(r.id);
      return;
    }
    if (r.label === undefined) return;
    if (!this.labeled.has(r.id)) {
      prev.label = r.label;
      this.labeled.add(r.id);
      return;
    }
    if (prev.label !== r.label)
      this.report("W102", l, r.start, r.end, { name: r.id, first: prev.label, second: r.label });
  }
}

/**
 * Arrow at position i. `-->` reply, `->` normal, `-x` failure, `~>` async (spacing is checked by the caller: E117).
 * `-x` only when preceded by whitespace/line start and followed by whitespace/line end (to distinguish from `-x` inside an id)
 */
const arrowAt = (t: string[], i: number): { kind: EdgeKind; len: number } | undefined => {
  if (t[i] === "~" && t[i + 1] === ">") return { kind: "async", len: 2 };
  if (t[i] !== "-") return;
  if (t[i + 1] === "-" && t[i + 2] === ">") return { kind: "reply", len: 3 };
  if (t[i + 1] === ">") return { kind: "ok", len: 2 };
  if (t[i + 1] === "x" && (i === 0 || /\s/.test(t[i - 1])) && (i + 2 >= t.length || /\s/.test(t[i + 2])))
    return { kind: "fail", len: 2 };
};
const isArrow = (t: string[], i: number) => arrowAt(t, i) !== undefined;
const skip = (t: string[], i: number) => {
  while (i < t.length && /\s/.test(t[i])) i++;
  return i;
};
