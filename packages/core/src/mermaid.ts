import { KEYWORDS, MESSAGES, fill, type Code } from "./diagnostics.js";
import { parse } from "./parse.js";

export interface MermaidWarning {
  line: number;
  message: string;
}
export interface MermaidResult {
  /** The converted `.ene` source; empty when nothing could be converted */
  source: string;
  warnings: MermaidWarning[];
  /** Set when the input cannot be converted, or the converted source still has an error (e.g. nesting too deep) */
  error?: string;
}

type Arrow = "->" | "-->" | "-x" | "~>";
type Node_ =
  | { t: "msg"; from: string; to: string; arrow: Arrow; label: string; line: number }
  | { t: "comment"; text: string }
  | { t: "note"; text: string; line: number }
  | { t: "block"; kind: BlockKind; arms: Arm[]; line: number };
interface Arm {
  label: string;
  body: Node_[];
  line: number;
}
type BlockKind = "alt" | "opt" | "loop" | "par" | "critical" | "break" | "rect" | "box";

/** Longest first, so `-->>` is not read as `-->` followed by `>` */
const ARROWS: [string, Arrow, boolean][] = [
  ["<<-->>", "-->", true],
  ["<<->>", "->", true],
  ["-->>", "-->", false],
  ["--)", "-->", false],
  ["--x", "-x", false],
  ["-->", "-->", false],
  ["->>", "->", false],
  ["-)", "~>", false],
  ["-x", "-x", false],
  ["->", "->", false],
];
const ARROW_RE = new RegExp(
  `^(.+?)\\s*(${ARROWS.map(([a]) => a.replace(/[)>]/g, "\\$&")).join("|")})\\s*([+-])?\\s*([^:]+?)\\s*(?::(.*))?$`,
);
const ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  nbsp: " ",
  colon: ":",
  semi: ";",
  hash: "#",
};
const SHAPE_BY_TYPE: Record<string, string> = { database: "db", queue: "queue", actor: "circle" };

/** `Hello<br/>world #35;1` → `Hello world #1` */
const text = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/#([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();

/**
 * Convert a Mermaid `sequenceDiagram` into `.ene` source (`diagram sequence`); a `flowchart` / `graph` goes to fromFlowchart.
 *
 * Messages, participants, `alt`/`else`, `opt`, `loop`, `par`, notes and comments are converted
 * (`opt` and `break` become ene `opt`; the async arrow `-)` becomes `~>`).
 * A note becomes an ene `note` on the message right above it (a comment when there is none).
 * Constructs with no equivalent (activation, `rect`, `box`, links) are dropped or kept as comments,
 * each with a warning that names the source line. The result always parses without errors.
 */
export function fromMermaid(input: string): MermaidResult {
  const warnings: MermaidWarning[] = [];
  const grouped = new Map<string, { line: number; message: string; more: number }>();
  /** Warnings of the same kind are reported once, at the first line */
  const warn = (line: number, message: string, kind?: string) => {
    if (!kind) return void warnings.push({ line, message });
    const g = grouped.get(kind);
    if (g) g.more++;
    else grouped.set(kind, { line, message, more: 0 });
  };

  const lines = extract(input);
  let title: string | undefined;
  let i = 0;
  // Front matter: `---` … `---` with an optional `title:`
  while (i < lines.length && !lines[i].text) i++;
  if (lines[i]?.text === "---") {
    for (i++; i < lines.length && lines[i].text !== "---"; i++) {
      const m = lines[i].text.match(/^title\s*:\s*(.+)$/);
      if (m) title = text(m[1].replace(/^(["'])(.*)\1$/, "$2"));
    }
    i++;
  }
  while (i < lines.length && (!lines[i].text || lines[i].text.startsWith("%%"))) i++;
  const header = lines[i]?.text ?? "";
  if (/^(flowchart|graph)\b/.test(header)) {
    // Re-read the diagram itself (header to the last line, inside its fence) with quote-aware statements
    const raw = input.replace(/^﻿/, "").split(/\r\n|\r|\n/);
    const from = lines[i].no,
      to = lines[lines.length - 1].no;
    return fromFlowchart(quotedStatements(raw.slice(from - 1, to).join("\n"), from), 0, title);
  }
  if (!/^sequenceDiagram\b/.test(header)) {
    const kind = header.split(/\s/, 1)[0];
    return {
      source: "",
      warnings: [],
      error: kind
        ? `only \`sequenceDiagram\`, \`flowchart\` and \`graph\` can be converted (found \`${kind}\`)`
        : "no Mermaid diagram found",
    };
  }
  i++;

  // name in the Mermaid source → ene id, in order of first appearance
  const decl = new Map<string, { label: string; shape?: string }>();
  const makeId = idMaker();
  const idOf = (name: string): string => {
    const id = makeId(name);
    if (!decl.has(id)) decl.set(id, { label: text(name.trim()) });
    return id;
  };

  const root: Node_[] = [];
  const stack: { block: Extract<Node_, { t: "block" }> }[] = [];
  const body = () =>
    stack.length ? stack[stack.length - 1].block.arms[stack[stack.length - 1].block.arms.length - 1].body : root;
  const open = (kind: BlockKind, label: string, line: number) => {
    const block: Extract<Node_, { t: "block" }> = { t: "block", kind, arms: [{ label, body: [], line }], line };
    body().push(block);
    stack.push({ block });
  };

  for (; i < lines.length; i++) {
    const { text: raw, no } = lines[i];
    const s = raw;
    if (!s) continue;
    if (/^%%\{.*\}%%$/.test(s)) continue;
    if (s.startsWith("%%")) {
      const c = s.slice(2).trim();
      if (c) body().push({ t: "comment", text: c });
      continue;
    }
    const word = s.split(/[\s:]/, 1)[0].toLowerCase();
    const rest = s.slice(word.length).trim();

    if (word === "title") {
      title = text(rest.replace(/^:\s*/, ""));
      continue;
    }
    if (word === "autonumber" || word === "acctitle" || word === "accdescr") continue;
    if (word === "participant" || word === "actor" || (word === "create" && /^(participant|actor)\b/i.test(rest))) {
      const created = word === "create";
      const kind = created ? rest.split(/\s/, 1)[0].toLowerCase() : word;
      let spec = created ? rest.slice(kind.length).trim() : rest;
      if (created) warn(no, "`create` is not supported; the participant is shown from the start", "create");
      let shape = kind === "actor" ? "circle" : undefined;
      let cfgAlias: string | undefined;
      // `A@{ "type": "database" }` (Mermaid 11.12+)
      const cfg = spec.match(/^(.*?)@\{(.*)\}\s*(.*)$/);
      if (cfg) {
        const type = cfg[2].match(/["']?type["']?\s*:\s*["']?([\w-]+)/)?.[1]?.toLowerCase();
        if (type && SHAPE_BY_TYPE[type]) shape = SHAPE_BY_TYPE[type];
        else if (type && type !== "participant")
          warn(no, `participant type \`${type}\` has no ene shape; drawn as a box`, "ptype");
        cfgAlias = cfg[2].match(/["']?alias["']?\s*:\s*(["'])(.*?)\1/)?.[2];
        spec = `${cfg[1]} ${cfg[3]}`.trim();
      }
      const m = spec.match(/^(.+?)\s+as\s+(.+)$/i);
      const name = (m ? m[1] : spec).trim();
      if (!name) {
        warn(no, `cannot read participant line: \`${s}\``);
        continue;
      }
      const id = idOf(name);
      const d = decl.get(id)!;
      if (m) d.label = text(m[2]);
      else if (cfgAlias) d.label = text(cfgAlias);
      if (shape) d.shape = shape;
      continue;
    }
    // Only a bare `end` closes a block, so a participant called "end user" still sends messages
    if (s.toLowerCase() === "end") {
      if (!stack.pop()) warn(no, "`end` without an open block is ignored");
      continue;
    }
    if (
      word === "alt" ||
      word === "opt" ||
      word === "loop" ||
      word === "par" ||
      word === "critical" ||
      word === "break" ||
      word === "rect" ||
      word === "box"
    ) {
      if (word === "par" && /^par\s+over\b/i.test(s)) warn(no, "`par over` is read as `par`", "parover");
      if (word === "critical") warn(no, "`critical` / `option` are converted to `branch` / `else`", "critical");
      if (word === "break") warn(no, "`break` is converted to `opt`; ene keeps playing the steps after it", "break");
      if (word === "rect") warn(no, "`rect` background highlights are dropped", "rect");
      if (word === "box")
        warn(no, "`box` participant groups are dropped (groups are not drawn in sequence diagrams)", "box");
      open(word, text(rest), no);
      continue;
    }
    if (word === "else" || word === "and" || word === "option") {
      const top = stack[stack.length - 1]?.block;
      const fits =
        top && (word === "else" ? top.kind === "alt" : word === "and" ? top.kind === "par" : top.kind === "critical");
      if (!fits) {
        warn(no, `\`${word}\` outside a matching block is ignored`);
        continue;
      }
      top.arms.push({ label: text(rest), body: [], line: no });
      continue;
    }
    if (word === "note") {
      // `Note over A,B: text` / `Note left of A: text` → the text only; ene shows it as a caption of the step
      const c = rest.indexOf(":");
      const note = text(c < 0 ? "" : rest.slice(c + 1));
      if (!note) {
        warn(no, "empty note is dropped");
        continue;
      }
      body().push({ t: "note", text: note, line: no });
      continue;
    }
    if (word === "activate" || word === "deactivate") {
      warn(no, "activation bars are not drawn", "activation");
      continue;
    }
    if (word === "destroy") {
      warn(no, "`destroy` is not supported; the participant stays", "destroy");
      continue;
    }
    if (word === "link" || word === "links" || word === "properties" || word === "details") {
      warn(no, "participant links and properties are dropped", "links");
      continue;
    }

    const m = s.match(ARROW_RE);
    if (m) {
      const [, from, sym, act, to, label] = m;
      const [, arrow, both] = ARROWS.find(([a]) => a === sym)!;
      if (both) warn(no, "two-way arrows are drawn one way, from the first participant", "twoway");
      if (act) warn(no, "activation bars are not drawn", "activation");
      body().push({ t: "msg", from: idOf(from), to: idOf(to), arrow, label: text(label ?? ""), line: no });
      continue;
    }
    warn(no, `not converted: \`${s}\``);
  }
  for (const f of stack)
    warn(f.block.line, `\`${f.block.kind}\` is never closed with \`end\`; closed at the end of the diagram`);

  // ---- emit ----
  const out: string[] = [];
  const safeEdge = (m: Extract<Node_, { t: "msg" }>): string => {
    const r = edgeText(`${m.from} ${m.arrow} ${m.to}`, m.label);
    if (r.adjusted) warn(m.line, `message text was adjusted so it stays one label: \`${m.label}\``);
    return r.text;
  };
  const safeLabel = (label: string, fallback: string, line: number): string => {
    if (!label) return fallback;
    const reads = (l: string) => {
      const st = parse(`branch ${l}\n a -> b\nend`).doc.body[0];
      return st?.type === "branch" && st.arms[0].label === l;
    };
    if (reads(label)) return label;
    const safe = label.replace(/#/g, "＃");
    warn(line, `block label was adjusted so \`#\` is not read as a comment: \`${label}\``);
    return reads(safe) ? safe : fallback;
  };
  /** Note text that reads back as the same note; a leading arrow (`note -> x` is E115) gets a Unicode hyphen */
  const safeNote = (note: string, line: number): string | undefined => {
    const reads = (n: string) => {
      const r = parse(`a -> b\nnote ${n}`);
      const st = r.doc.body[0];
      return !r.diagnostics.some((d) => d.severity === "error") && st?.type === "step" && st.note === n;
    };
    if (reads(note)) return note;
    const safe = note.replace(/^-/, "‐");
    warn(line, `note text was adjusted so it is not read as an edge: \`${note}\``);
    return reads(safe) ? safe : undefined;
  };
  const noteLine = (pad: string, c: Extract<Node_, { t: "note" }>) => {
    const n = safeNote(c.text, c.line);
    return n === undefined ? `${pad}# note: ${c.text}` : `${pad}note ${n}`;
  };
  const single = (arm: Arm) => {
    const real = arm.body.filter((n) => n.t !== "comment" && n.t !== "note");
    return real.length === 1 && real[0].t === "msg" ? real[0] : undefined;
  };

  /** Returns the number of steps written */
  const emit = (nodes: Node_[], depth: number): number => {
    const pad = "  ".repeat(depth);
    let n = 0;
    /** The last statement written in this body is a step, so a note can attach to it */
    let afterStep = false;
    for (const node of nodes) {
      if (node.t === "comment") {
        out.push(`${pad}# ${node.text}`);
        continue;
      }
      if (node.t === "note") {
        if (afterStep) out.push(noteLine(pad, node));
        else {
          warn(node.line, "a note with no message right above it is kept as a comment", "orphan-note");
          out.push(`${pad}# note: ${node.text}`);
        }
        continue;
      }
      afterStep = false;
      if (node.t === "msg") {
        out.push(pad + safeEdge(node));
        n++;
        afterStep = true;
        continue;
      }
      const { kind, arms } = node;
      if (kind === "rect" || kind === "box") {
        for (const a of arms) n += emit(a.body, depth);
        continue;
      }
      if (kind === "par") {
        const msgs = arms.map(single);
        if (msgs.every((m) => m)) {
          for (const a of arms) for (const c of a.body) if (c.t === "comment") out.push(`${pad}# ${c.text}`);
          out.push(pad + msgs.map((m) => safeEdge(m!)).join(" & "));
          n++;
          afterStep = true;
          for (const a of arms) for (const c of a.body) if (c.t === "note") out.push(noteLine(pad, c));
        } else {
          warn(node.line, "`par` with more than one message per arm is played one arm after another");
          for (const a of arms) {
            if (a.label) out.push(`${pad}# par: ${a.label}`);
            n += emit(a.body, depth);
          }
        }
        continue;
      }
      if (kind === "loop") {
        const label = arms[0].label;
        const num = label.match(/\b(\d{1,2})\b/);
        const count = num && Number(num[1]) >= 1 && Number(num[1]) <= 20 ? Number(num[1]) : 0;
        if (!count) warn(node.line, `loop \`${label}\` has no repeat count in Mermaid; set to \`loop 2\``, "loop");
        const at = out.length;
        if (label) out.push(`${pad}# loop: ${label}`);
        out.push(`${pad}loop ${count || 2}`);
        const inner = emit(arms[0].body, depth + 1);
        if (!inner) {
          out.length = at;
          continue;
        }
        out.push(`${pad}end`);
        n += inner * (count || 2);
        continue;
      }
      if (kind === "opt" || kind === "break") {
        const at = out.length;
        out.push(`${pad}opt ${safeLabel(arms[0].label, "", arms[0].line)}`.trimEnd());
        const inner = emit(arms[0].body, depth + 1);
        if (!inner) {
          out.length = at;
          continue;
        }
        out.push(`${pad}end`);
        n += inner;
        continue;
      }
      // alt / critical → branch with one arm per `else` / `option`
      const all = arms;
      const at = out.length;
      let any = 0;
      all.forEach((a, k) => {
        const fallback = k === 0 ? kind : all.length === 2 ? "else" : `else ${k}`;
        out.push(`${pad}${k === 0 ? "branch" : "else"} ${safeLabel(a.label, fallback, a.line)}`);
        const inner = emit(a.body, depth + 1);
        // every ene arm needs a step; `wait 0` plays nothing
        if (!inner) out.push(`${pad}  wait 0`);
        any += inner;
      });
      if (!any) {
        out.length = at;
        continue;
      }
      out.push(`${pad}end`);
      n += any;
    }
    return n;
  };
  const bodyAt = out.length;
  if (!emit(root, 0))
    return { source: "", warnings: flush(warnings, grouped), error: "the diagram has no messages to play" };

  const head: string[] = ["diagram sequence"];
  if (title) head.push(`title ${title}`);
  head.push("");
  for (const [id, d] of decl) {
    const label = d.label.replace(/\[/g, "(").replace(/\]/g, ")");
    head.push(`${id}[${label || id}]${d.shape ? `{shape: ${d.shape}}` : ""}`);
  }
  head.push("");
  out.splice(bodyAt, 0, ...head);
  const source = `${out.join("\n")}\n`;
  const bad = parse(source).diagnostics.find((d) => d.severity === "error");
  const result: MermaidResult = { source, warnings: flush(warnings, grouped) };
  if (bad)
    result.error = `the converted source has an error on line ${bad.span.line}: ${fill(MESSAGES.en[bad.code as Code].message, bad.args)}`;
  return result;
}

/** `head : label` that parses back as one edge with exactly this label */
function edgeText(head: string, label: string): { text: string; adjusted: boolean } {
  if (!label) return { text: head, adjusted: false };
  const reads = (l: string) => {
    const r = parse(`${head} : ${l}`);
    const st = r.doc.body[0];
    return (
      !r.diagnostics.some((d) => d.severity === "error") &&
      r.doc.body.length === 1 &&
      st.type === "step" &&
      st.edges.length === 1 &&
      st.edges[0].label === l &&
      st.edges[0].duration === undefined
    );
  };
  if (reads(label)) return { text: `${head} : ${label}`, adjusted: false };
  // `@…` at the end reads as a duration, ` & a -> b` as a second edge: swap the characters that trigger it
  const safe = label.replace(/@/g, "＠").replace(/&/g, "＆");
  return { text: reads(safe) ? `${head} : ${safe}` : head, adjusted: true };
}

/** Mermaid name → ene id: invalid characters become `_`, keywords get a `_` suffix, duplicates a number */
function idMaker() {
  const ids = new Map<string, string>(),
    used = new Set<string>();
  return (name: string): string => {
    const key = name.trim();
    let id = ids.get(key);
    if (id) return id;
    let base = key
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}_-]+/gu, "_")
      .replace(/^[-_]+|[-_]+$/g, "");
    if (!base) base = "p";
    if (KEYWORDS.includes(base)) base += "_";
    id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    ids.set(key, id);
    used.add(id);
    return id;
  };
}

function flush(
  warnings: MermaidWarning[],
  grouped: Map<string, { line: number; message: string; more: number }>,
): MermaidWarning[] {
  for (const g of grouped.values())
    warnings.push({
      line: g.line,
      message: g.more ? `${g.message} (and on ${g.more} more line${g.more > 1 ? "s" : ""})` : g.message,
    });
  return warnings.sort((a, b) => a.line - b.line);
}

/**
 * Statements of the diagram with their original line numbers; a ```mermaid fence in Markdown is unwrapped.
 * `;` separates statements on one line, except where it closes an entity such as `#59;` and inside `%%` comments.
 */
function extract(input: string): { text: string; no: number }[] {
  const all = input
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .flatMap((l, k) => {
      const line = l.trim();
      const parts = line.startsWith("%%")
        ? [line]
        : line
            .split(/(?<!#\w+);/)
            .map((p) => p.trim())
            .filter(Boolean);
      return (parts.length ? parts : [""]).map((text) => ({ text, no: k + 1 }));
    });
  const fences: { from: number; to: number }[] = [];
  for (let k = 0; k < all.length; k++) {
    if (!/^(```|~~~)\s*mermaid\b/i.test(all[k].text)) continue;
    const close = all.findIndex((l, j) => j > k && /^(```|~~~)\s*$/.test(l.text));
    fences.push({ from: k + 1, to: close < 0 ? all.length : close });
    if (close < 0) break;
    k = close;
  }
  if (!fences.length) return all;
  const pick =
    fences.find((f) => all.slice(f.from, f.to).some((l) => /^(sequenceDiagram|flowchart|graph)\b/.test(l.text))) ??
    fences[0];
  return all.slice(pick.from, pick.to);
}

// ---- flowchart / graph ----

/** Mermaid node shapes (longest opener first) → ene shape; `undefined` = no ene shape, drawn as a box with a warning */
const FC_SHAPES: [open: string, close: string, shape: string | undefined, name: string][] = [
  ["(((", ")))", "circle", "double circle"],
  ["((", "))", "circle", "circle"],
  ["([", "])", "round", "stadium"],
  ["[[", "]]", undefined, "subroutine"],
  ["[(", ")]", "db", "cylinder"],
  ["[/", "/]", undefined, "parallelogram"],
  ["[\\", "\\]", undefined, "parallelogram"],
  ["[/", "\\]", undefined, "trapezoid"],
  ["[\\", "/]", undefined, "trapezoid"],
  ["{{", "}}", undefined, "hexagon"],
  ["(", ")", "round", "rounded"],
  ["[", "]", "box", "rectangle"],
  ["{", "}", undefined, "rhombus"],
  [">", "]", undefined, "flag"],
];
/** `A@{ shape: … }` names (Mermaid 11.3+) */
const FC_NAMED: Record<string, string> = {
  rect: "box",
  rectangle: "box",
  proc: "box",
  process: "box",
  rounded: "round",
  event: "round",
  stadium: "round",
  pill: "round",
  terminal: "round",
  circle: "circle",
  circ: "circle",
  "sm-circ": "circle",
  "dbl-circ": "circle",
  cyl: "db",
  cylinder: "db",
  db: "db",
  database: "db",
  "h-cyl": "queue",
  das: "queue",
  "horizontal-cylinder": "queue",
};
const FC_ID = /^[\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*/u;
/** A link: `-->`, `---`, `-.->`, `==>`, `--x`, `--o`, `<-->`, `~~~`, optionally `|label|`; or `-- label -->` style */
const FC_TEXT_LINK = /^\s*([<ox]?)(--|==|-\.)\s+(.+?)\s+(-{2,}|={2,}|\.+-)(>|x|o)?(?=\s|$|[\p{L}\p{N}_])\s*/u;
const FC_LINK =
  /^\s*([<ox]?)(-{2,}|={2,}|-\.+-|~{3,})(>|x(?=[\s|]|$)|o(?=[\s|]|$))?\s*(?:\|(\s*"[^"]*"\s*|[^|]*)\|)?\s*/;

interface FcNode {
  id: string;
  label: string;
  shape?: string;
  line: number;
  group?: string;
}
interface FcGroup {
  id: string;
  label: string;
  parent?: string;
  line: number;
  mentions: Set<string>;
}
type FcItem =
  | { t: "edge"; from: string; to: string; arrow: Arrow; label: string; line: number }
  | { t: "comment"; text: string };

/**
 * Convert a Mermaid `flowchart` / `graph` into `.ene` source (flow layout).
 * Every edge becomes one step, in source order; `subgraph` becomes `group`. A flowchart has no time axis,
 * so the output starts with a comment asking to review the step order.
 */
function fromFlowchart(lines: { text: string; no: number }[], at: number, title: string | undefined): MermaidResult {
  const warnings: MermaidWarning[] = [];
  const grouped = new Map<string, { line: number; message: string; more: number }>();
  const warn = (line: number, message: string, kind?: string) => {
    if (!kind) return void warnings.push({ line, message });
    const g = grouped.get(kind);
    if (g) g.more++;
    else grouped.set(kind, { line, message, more: 0 });
  };
  const head = lines[at];
  const dir = head.text.split(/\s+/)[1]?.replace(/;$/, "").toUpperCase();
  warn(head.no, "each link becomes one step in source order; a flowchart has no time axis, so review the order");
  if (dir && dir !== "LR") warn(head.no, `direction \`${dir}\` is ignored; ene lays out flows left to right`);

  // Subgraph ids first: an edge to a subgraph has no ene equivalent
  const subIds = new Set<string>();
  for (const l of lines.slice(at + 1)) {
    const m = l.text.match(/^subgraph\s+(.*)$/i);
    if (m) subIds.add(subgraphHead(m[1]).id);
  }

  const nodes = new Map<string, FcNode>();
  const groups: FcGroup[] = [];
  const items: FcItem[] = [];
  const stack: FcGroup[] = [],
    closed: FcGroup[] = [];
  const nodeId = idMaker(),
    groupId = idMaker();

  /** Read one node reference at s; returns its ene id and the rest, or undefined */
  const node = (s: string, line: number): { id: string; rest: string } | undefined => {
    const m = s.match(FC_ID);
    if (!m) return;
    const name = m[0];
    // declared: this mention sets the shape (a bare reference keeps the earlier one)
    let rest = s.slice(name.length),
      label: string | undefined,
      shape: string | undefined,
      declared = false;
    for (const [open, close, sh, shapeName] of FC_SHAPES) {
      if (!rest.startsWith(open)) continue;
      let body = rest.slice(open.length),
        end: number;
      const q = body.match(/^\s*"/);
      if (q) {
        const c = body.indexOf('"', q[0].length);
        end = c < 0 ? -1 : body.indexOf(close, c + 1);
      } else end = body.indexOf(close);
      if (end < 0) continue;
      label = mdText(body.slice(0, end));
      rest = body.slice(end + close.length);
      shape = sh;
      declared = true;
      if (!sh) warn(line, `the ${shapeName} shape has no ene equivalent; drawn as a box`, `shape-${shapeName}`);
      break;
    }
    const cfg = rest.startsWith("@{") ? configBlock(rest) : undefined;
    if (cfg) {
      const sh = cfg[1].match(/shape\s*:\s*["']?([\w-]+)/)?.[1]?.toLowerCase();
      if (sh) declared = true;
      if (sh && FC_NAMED[sh]) shape = FC_NAMED[sh];
      else if (sh) warn(line, `shape \`${sh}\` has no ene equivalent; drawn as a box`, `shape-${sh}`);
      const lab = cfg[1].match(/label\s*:\s*(["'])(.*?)\1/)?.[2];
      if (lab !== undefined) label = mdText(lab);
      if (/\b(icon|img)\s*:/.test(cfg[1])) warn(line, "node icons and images are dropped", "img");
      rest = rest.slice(cfg[0].length);
    }
    const cls = rest.match(/^:::[\w-]+/);
    if (cls) {
      warn(line, "`:::class` styles are dropped", "classref");
      rest = rest.slice(cls[0].length);
    }
    if (subIds.has(name) && label === undefined && !declared) return { id: `\u0000${name}`, rest };
    const id = nodeId(name);
    let n = nodes.get(id);
    if (!n) {
      n = { id, label: text(name), line };
      nodes.set(id, n);
    }
    if (label !== undefined) n.label = label;
    if (declared) {
      if (shape && shape !== "box") n.shape = shape;
      else delete n.shape;
    }
    if (stack.length) stack[stack.length - 1].mentions.add(id);
    return { id, rest };
  };
  /** `a & b` */
  const nodeGroup = (s: string, line: number): { ids: string[]; rest: string } | undefined => {
    const ids: string[] = [];
    let rest = s;
    for (;;) {
      const r = node(rest.trimStart(), line);
      if (!r) return;
      ids.push(r.id);
      rest = r.rest;
      const amp = rest.match(/^\s*&\s*/);
      if (!amp) return { ids, rest };
      rest = rest.slice(amp[0].length);
    }
  };

  for (let i = at + 1; i < lines.length; i++) {
    const { text: s, no } = lines[i];
    if (!s || /^%%\{.*\}%%$/.test(s)) continue;
    if (s.startsWith("%%")) {
      const c = s.slice(2).trim();
      if (c) items.push({ t: "comment", text: c });
      continue;
    }
    const word = s.split(/\s/, 1)[0].toLowerCase();
    if (word === "subgraph") {
      const h = subgraphHead(s.slice(8).trim());
      const g: FcGroup = {
        id: groupId(h.id),
        label: h.label,
        line: no,
        mentions: new Set(),
        ...(stack.length ? { parent: stack[stack.length - 1].id } : {}),
      };
      groups.push(g);
      stack.push(g);
      continue;
    }
    if (s.toLowerCase() === "end") {
      const g = stack.pop();
      if (g) closed.push(g);
      else warn(no, "`end` without an open subgraph is ignored");
      continue;
    }
    if (word === "direction") {
      warn(no, "`direction` inside a subgraph is ignored", "direction");
      continue;
    }
    if (word === "style" || word === "classdef" || word === "class" || word === "linkstyle") {
      warn(no, "styles and classes are dropped", "style");
      continue;
    }
    if (word === "click") {
      warn(no, "click handlers and links are dropped", "click");
      continue;
    }
    if (word === "title") {
      title = text(s.slice(5).replace(/^\s*:?\s*/, ""));
      continue;
    }
    if (word === "acctitle" || word === "accdescr" || word.startsWith("acctitle:") || word.startsWith("accdescr"))
      continue;

    const known = new Set(nodes.keys());
    const first = nodeGroup(s, no);
    if (!first) {
      warn(no, `not converted: \`${s}\``);
      continue;
    }
    let from = first.ids,
      rest = first.rest,
      ok = true,
      linked = false;
    while (rest.trim()) {
      // An edge id (`A e1@--> B`) is dropped
      rest = rest.replace(/^\s*[\w-]+@(?=[-=.<ox~])/, " ");
      const tm = rest.match(FC_TEXT_LINK),
        lm = tm ? undefined : rest.match(FC_LINK);
      if (!tm && !lm) {
        ok = false;
        break;
      }
      const [all, start, body, label, head2] = tm
        ? [tm[0], tm[1], tm[2] + tm[4], tm[3], tm[5]]
        : [lm![0], lm![1], lm![2], lm![4] ?? "", lm![3]];
      rest = rest.slice(all.length);
      const to = nodeGroup(rest, no);
      if (!to) {
        ok = false;
        break;
      }
      rest = to.rest;
      linked = true;
      if (body.startsWith("~")) {
        warn(no, "invisible links (`~~~`) are dropped", "invisible");
        from = to.ids;
        continue;
      }
      const dotted = body.includes(".");
      const arrow: Arrow = head2 === "x" ? "-x" : dotted ? "-->" : "->";
      if (head2 === "o") warn(no, "circle arrowheads (`--o`) are drawn as plain arrows", "circlehead");
      else if (!head2) warn(no, "links without an arrowhead are drawn as arrows", "open");
      if (start === "<" || start === "o" || start === "x")
        warn(no, "two-way links are drawn one way, from the first node", "twoway");
      for (const a of from)
        for (const b of to.ids) {
          if (a.startsWith("\u0000") || b.startsWith("\u0000")) {
            warn(no, "links to a subgraph are dropped (ene groups cannot be edge ends)", "subedge");
            continue;
          }
          items.push({ t: "edge", from: a, to: b, arrow, label: mdText(label), line: no });
        }
      from = to.ids;
    }
    // Nothing was read as a link: forget the nodes this line introduced
    if (!ok && !linked) for (const id of nodes.keys()) if (!known.has(id)) nodes.delete(id);
    if (!ok) warn(no, linked ? `not converted (only part of the line was read): \`${s}\`` : `not converted: \`${s}\``);
  }
  for (const g of stack) warn(g.line, "`subgraph` is never closed with `end`; closed at the end of the diagram");
  // Like Mermaid: a subgraph takes the nodes it mentions that no subgraph closed before it has taken (inner ones close first)
  for (const g of [...closed, ...stack.reverse()])
    for (const id of g.mentions) {
      const n = nodes.get(id);
      if (n) n.group ??= g.id;
    }

  // ---- emit ----
  const out: string[] = [
    "# Converted from a Mermaid flowchart: each edge is one step, in source order.",
    "# A flowchart has no time axis, so review the step order.",
    "",
  ];
  if (title) out.push(`title ${title}`, "");
  const label = (s: string) => s.replace(/\[/g, "(").replace(/\]/g, ")");
  for (const n of nodes.values()) {
    const l = label(n.label) || n.id;
    out.push(`${n.id}[${l}]${n.shape ? `{shape: ${n.shape}}` : ""}`);
  }
  out.push("");
  let steps = 0;
  for (const it of items) {
    if (it.t === "comment") {
      out.push(`# ${it.text}`);
      continue;
    }
    const r = edgeText(`${it.from} ${it.arrow} ${it.to}`, it.label);
    if (r.adjusted) warn(it.line, `link text was adjusted so it stays one label: \`${it.label}\``);
    out.push(r.text);
    steps++;
  }
  if (!steps) return { source: "", warnings: flush(warnings, grouped), error: "the flowchart has no links to play" };

  // Groups: an ene nested group lists every node of its subtree (its members must be members of the parent)
  const deep = (gid: string): string[] => [
    ...[...nodes.values()].filter((n) => n.group === gid).map((n) => n.id),
    ...groups.filter((g) => g.parent === gid).flatMap((g) => deep(g.id)),
  ];
  const kept = new Set<string>();
  const gl: string[] = [];
  for (const g of groups) {
    const members = deep(g.id);
    if (!members.length) {
      warn(g.line, "a subgraph with no nodes is dropped");
      continue;
    }
    if (g.parent && !kept.has(g.parent)) continue;
    kept.add(g.id);
    gl.push(`group ${g.id}[${label(g.label) || g.id}]${g.parent ? ` in ${g.parent}` : ""} : ${members.join(" ")}`);
  }
  if (gl.length) out.push("", ...gl);
  const source = `${out.join("\n")}\n`;
  const bad = parse(source).diagnostics.find((d) => d.severity === "error");
  const result: MermaidResult = { source, warnings: flush(warnings, grouped) };
  if (bad)
    result.error = `the converted source has an error on line ${bad.span.line}: ${fill(MESSAGES.en[bad.code as Code].message, bad.args)}`;
  return result;
}

/** `@{ … }` at the start of s, with `}` inside quotes kept: [whole, inside] like a regex match */
function configBlock(s: string): [string, string] | undefined {
  let q: string | undefined;
  for (let k = 2; k < s.length; k++) {
    const c = s[k];
    if (q) {
      if (c === q) q = undefined;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "}") return [s.slice(0, k + 1), s.slice(2, k)];
  }
  return undefined;
}

/**
 * Flowchart statements: like extract(), but `;` and line breaks inside `"…"` belong to the label
 * (a multi-line label is joined with spaces and keeps the line number where it starts).
 */
function quotedStatements(input: string, first: number): { text: string; no: number }[] {
  const out: { text: string; no: number }[] = [];
  let cur = "",
    no = first,
    start = first,
    q = false;
  const push = () => {
    const t = cur.trim();
    if (t || !out.length || out[out.length - 1].no !== start) out.push({ text: t, no: start });
    cur = "";
  };
  for (const c of input) {
    const comment = cur.trimStart().startsWith("%%");
    if (c === '"' && !comment) q = !q;
    if (c === "\n") {
      no++;
      if (q) {
        cur += " ";
        continue;
      }
      push();
      start = no;
      continue;
    }
    if (c === ";" && !q && !comment && !/#\w+$/.test(cur)) {
      push();
      continue;
    }
    cur += c;
  }
  push();
  return out;
}

/** `id [Title]` / `id["Title"]` / `"Title"` / `Title words` → id and label */
function subgraphHead(s: string): { id: string; label: string } {
  const m = s.match(/^([^\s[]+)\s*\[(.*)\]$/);
  if (m) return { id: m[1], label: mdText(m[2]) };
  const q = s.match(/^"(.*)"$/);
  if (q) return { id: q[1], label: mdText(q[1]) };
  return { id: s || "group", label: text(s) };
}

/** Node / link text: quotes, Markdown strings (`"`**a**`"`) and entities */
const mdText = (s: string) =>
  text(
    s
      .trim()
      .replace(/^"(.*)"$/s, "$1")
      .replace(/^`(.*)`$/s, "$1")
      .replace(/\*\*(.+?)\*\*|\*(.+?)\*/g, "$1$2"),
  );
