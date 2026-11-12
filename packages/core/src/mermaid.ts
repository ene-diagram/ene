import { KEYWORDS, MESSAGES, fill, type Code } from "./diagnostics.js";
import { parse } from "./parse.js";

export interface MermaidWarning { line: number; message: string }
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
interface Arm { label: string; body: Node_[]; line: number }
type BlockKind = "alt" | "opt" | "loop" | "par" | "critical" | "break" | "rect" | "box";

/** Longest first, so `-->>` is not read as `-->` followed by `>` */
const ARROWS: [string, Arrow, boolean][] = [
  ["<<-->>", "-->", true], ["<<->>", "->", true],
  ["-->>", "-->", false], ["--)", "-->", false], ["--x", "-x", false], ["-->", "-->", false],
  ["->>", "->", false], ["-)", "~>", false], ["-x", "-x", false], ["->", "->", false],
];
const ARROW_RE = new RegExp(`^(.+?)\\s*(${ARROWS.map(([a]) => a.replace(/[)>]/g, "\\$&")).join("|")})\\s*([+-])?\\s*([^:]+?)\\s*(?::(.*))?$`);
const ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", nbsp: " ", colon: ":", semi: ";", hash: "#" };
const SHAPE_BY_TYPE: Record<string, string> = { database: "db", queue: "queue", actor: "circle" };

/** `Hello<br/>world #35;1` → `Hello world #1` */
const text = (s: string) => s
  .replace(/<br\s*\/?>/gi, " ")
  .replace(/#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/#([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
  .replace(/\s+/g, " ").trim();

/**
 * Convert a Mermaid `sequenceDiagram` into `.ene` source (`diagram sequence`).
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
  if (!/^sequenceDiagram\b/.test(header)) {
    const kind = header.split(/\s/, 1)[0];
    return { source: "", warnings: [], error: kind ? `only \`sequenceDiagram\` can be converted (found \`${kind}\`)` : "no Mermaid diagram found" };
  }
  i++;

  // name in the Mermaid source → ene id, in order of first appearance
  const ids = new Map<string, string>();
  const decl = new Map<string, { label: string; shape?: string }>();
  const idOf = (name: string): string => {
    const key = name.trim();
    let id = ids.get(key);
    if (id) return id;
    let base = key.normalize("NFC").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^[-_]+|[-_]+$/g, "");
    if (!base) base = "p";
    if (KEYWORDS.includes(base)) base += "_";
    id = base;
    for (let n = 2; [...ids.values()].includes(id); n++) id = `${base}_${n}`;
    ids.set(key, id);
    decl.set(id, { label: text(key) });
    return id;
  };

  const root: Node_[] = [];
  const stack: { block: Extract<Node_, { t: "block" }> }[] = [];
  const body = () => (stack.length ? stack[stack.length - 1].block.arms[stack[stack.length - 1].block.arms.length - 1].body : root);
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
    if (s.startsWith("%%")) { const c = s.slice(2).trim(); if (c) body().push({ t: "comment", text: c }); continue; }
    const word = s.split(/[\s:]/, 1)[0].toLowerCase();
    const rest = s.slice(word.length).trim();

    if (word === "title") { title = text(rest.replace(/^:\s*/, "")); continue; }
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
        else if (type && type !== "participant") warn(no, `participant type \`${type}\` has no ene shape; drawn as a box`, "ptype");
        cfgAlias = cfg[2].match(/["']?alias["']?\s*:\s*(["'])(.*?)\1/)?.[2];
        spec = `${cfg[1]} ${cfg[3]}`.trim();
      }
      const m = spec.match(/^(.+?)\s+as\s+(.+)$/i);
      const name = (m ? m[1] : spec).trim();
      if (!name) { warn(no, `cannot read participant line: \`${s}\``); continue; }
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
    if (word === "alt" || word === "opt" || word === "loop" || word === "par" || word === "critical" || word === "break" || word === "rect" || word === "box") {
      if (word === "par" && /^par\s+over\b/i.test(s)) warn(no, "`par over` is read as `par`", "parover");
      if (word === "critical") warn(no, "`critical` / `option` are converted to `branch` / `else`", "critical");
      if (word === "break") warn(no, "`break` is converted to `opt`; ene keeps playing the steps after it", "break");
      if (word === "rect") warn(no, "`rect` background highlights are dropped", "rect");
      if (word === "box") warn(no, "`box` participant groups are dropped (groups are not drawn in sequence diagrams)", "box");
      open(word, text(rest), no);
      continue;
    }
    if (word === "else" || word === "and" || word === "option") {
      const top = stack[stack.length - 1]?.block;
      const fits = top && (word === "else" ? top.kind === "alt" : word === "and" ? top.kind === "par" : top.kind === "critical");
      if (!fits) { warn(no, `\`${word}\` outside a matching block is ignored`); continue; }
      top.arms.push({ label: text(rest), body: [], line: no });
      continue;
    }
    if (word === "note") {
      // `Note over A,B: text` / `Note left of A: text` → the text only; ene shows it as a caption of the step
      const c = rest.indexOf(":");
      const note = text(c < 0 ? "" : rest.slice(c + 1));
      if (!note) { warn(no, "empty note is dropped"); continue; }
      body().push({ t: "note", text: note, line: no });
      continue;
    }
    if (word === "activate" || word === "deactivate") { warn(no, "activation bars are not drawn", "activation"); continue; }
    if (word === "destroy") { warn(no, "`destroy` is not supported; the participant stays", "destroy"); continue; }
    if (word === "link" || word === "links" || word === "properties" || word === "details") { warn(no, "participant links and properties are dropped", "links"); continue; }

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
  for (const f of stack) warn(f.block.line, `\`${f.block.kind}\` is never closed with \`end\`; closed at the end of the diagram`);

  // ---- emit ----
  const out: string[] = [];
  const safeEdge = (m: Extract<Node_, { t: "msg" }>): string => {
    const head = `${m.from} ${m.arrow} ${m.to}`;
    if (!m.label) return head;
    const reads = (label: string) => {
      const r = parse(`${head} : ${label}`);
      const st = r.doc.body[0];
      return !r.diagnostics.some((d) => d.severity === "error") && r.doc.body.length === 1 && st.type === "step" && st.edges.length === 1
        && st.edges[0].label === label && st.edges[0].duration === undefined;
    };
    if (reads(m.label)) return `${head} : ${m.label}`;
    // `@…` at the end reads as a duration, ` & a -> b` as a second edge: swap the characters that trigger it
    const safe = m.label.replace(/@/g, "＠").replace(/&/g, "＆");
    warn(m.line, `message text was adjusted so it stays one label: \`${m.label}\``);
    return reads(safe) ? `${head} : ${safe}` : head;
  };
  const safeLabel = (label: string, fallback: string, line: number): string => {
    if (!label) return fallback;
    const reads = (l: string) => { const st = parse(`branch ${l}\n a -> b\nend`).doc.body[0]; return st?.type === "branch" && st.arms[0].label === l; };
    if (reads(label)) return label;
    const safe = label.replace(/#/g, "＃");
    warn(line, `block label was adjusted so \`#\` is not read as a comment: \`${label}\``);
    return reads(safe) ? safe : fallback;
  };
  /** Note text that reads back as the same note; a leading arrow (`note -> x` is E115) gets a Unicode hyphen */
  const safeNote = (note: string, line: number): string | undefined => {
    const reads = (n: string) => { const r = parse(`a -> b\nnote ${n}`); const st = r.doc.body[0];
      return !r.diagnostics.some((d) => d.severity === "error") && st?.type === "step" && st.note === n; };
    if (reads(note)) return note;
    const safe = note.replace(/^-/, "‐");
    warn(line, `note text was adjusted so it is not read as an edge: \`${note}\``);
    return reads(safe) ? safe : undefined;
  };
  const noteLine = (pad: string, c: Extract<Node_, { t: "note" }>) => {
    const n = safeNote(c.text, c.line);
    return n === undefined ? `${pad}# note: ${c.text}` : `${pad}note ${n}`;
  };
  const single = (arm: Arm) => { const real = arm.body.filter((n) => n.t !== "comment" && n.t !== "note"); return real.length === 1 && real[0].t === "msg" ? real[0] : undefined; };

  /** Returns the number of steps written */
  const emit = (nodes: Node_[], depth: number): number => {
    const pad = "  ".repeat(depth);
    let n = 0;
    /** The last statement written in this body is a step, so a note can attach to it */
    let afterStep = false;
    for (const node of nodes) {
      if (node.t === "comment") { out.push(`${pad}# ${node.text}`); continue; }
      if (node.t === "note") {
        if (afterStep) out.push(noteLine(pad, node));
        else {
          warn(node.line, "a note with no message right above it is kept as a comment", "orphan-note");
          out.push(`${pad}# note: ${node.text}`);
        }
        continue;
      }
      afterStep = false;
      if (node.t === "msg") { out.push(pad + safeEdge(node)); n++; afterStep = true; continue; }
      const { kind, arms } = node;
      if (kind === "rect" || kind === "box") { for (const a of arms) n += emit(a.body, depth); continue; }
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
          for (const a of arms) { if (a.label) out.push(`${pad}# par: ${a.label}`); n += emit(a.body, depth); }
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
        if (!inner) { out.length = at; continue; }
        out.push(`${pad}end`);
        n += inner * (count || 2);
        continue;
      }
      if (kind === "opt" || kind === "break") {
        const at = out.length;
        out.push(`${pad}opt ${safeLabel(arms[0].label, "", arms[0].line)}`.trimEnd());
        const inner = emit(arms[0].body, depth + 1);
        if (!inner) { out.length = at; continue; }
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
      if (!any) { out.length = at; continue; }
      out.push(`${pad}end`);
      n += any;
    }
    return n;
  };
  const bodyAt = out.length;
  if (!emit(root, 0)) return { source: "", warnings: flush(warnings, grouped), error: "the diagram has no messages to play" };

  const head: string[] = ["diagram sequence"];
  if (title) head.push(`title ${title}`);
  head.push("");
  for (const [id, d] of decl) {
    const label = d.label.replace(/\[/g, "(").replace(/\]/g, ")");
    head.push(`${id}[${label || id}]${d.shape ? `{shape: ${d.shape}}` : ""}`);
  }
  head.push("");
  out.splice(bodyAt, 0, ...head);
  const source = out.join("\n") + "\n";
  const bad = parse(source).diagnostics.find((d) => d.severity === "error");
  const result: MermaidResult = { source, warnings: flush(warnings, grouped) };
  if (bad) result.error = `the converted source has an error on line ${bad.span.line}: ${fill(MESSAGES.en[bad.code as Code].message, bad.args)}`;
  return result;
}

function flush(warnings: MermaidWarning[], grouped: Map<string, { line: number; message: string; more: number }>): MermaidWarning[] {
  for (const g of grouped.values())
    warnings.push({ line: g.line, message: g.more ? `${g.message} (and on ${g.more} more line${g.more > 1 ? "s" : ""})` : g.message });
  return warnings.sort((a, b) => a.line - b.line);
}

/**
 * Statements of the diagram with their original line numbers; a ```mermaid fence in Markdown is unwrapped.
 * `;` separates statements on one line, except where it closes an entity such as `#59;` and inside `%%` comments.
 */
function extract(input: string): { text: string; no: number }[] {
  const all = input.replace(/^﻿/, "").split(/\r\n|\r|\n/).flatMap((l, k) => {
    const line = l.trim();
    const parts = line.startsWith("%%") ? [line] : line.split(/(?<!#\w+);/).map((p) => p.trim()).filter(Boolean);
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
  const pick = fences.find((f) => all.slice(f.from, f.to).some((l) => /^sequenceDiagram\b/.test(l.text))) ?? fences[0];
  return all.slice(pick.from, pick.to);
}
