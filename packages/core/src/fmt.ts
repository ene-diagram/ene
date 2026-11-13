import { parse } from "./parse.js";

/**
 * Canonical formatter for .ene sources.
 *
 * - 2-space indentation inside `branch` / `opt` / `else` / `loop` blocks
 * - single spaces around arrows, `&` and the label `:`; `key: value, key: value` inside `{...}`
 * - single space after keywords; collapses runs of blank lines; trailing newline
 * - comments are kept (full-line comments are re-indented, trailing comments get one space before `#`)
 *
 * Safety net: the formatted source must parse to the same document and diagnostics as the input.
 * If a line's rewrite would change the meaning, that line keeps its original body (only re-indented).
 */
export function formatSource(source: string): string {
  const raw = source.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const lines = raw.map(splitComment);
  let depth = 0;
  const indents: number[] = [];
  for (const { body } of lines) {
    const word = body.split(/\s/, 1)[0];
    if (word === "end" || word === "else") depth = Math.max(0, depth - 1);
    indents.push(depth);
    if (word === "loop" || word === "branch" || word === "opt" || word === "else") depth++;
  }
  const render = (bodies: string[]) => {
    const out: string[] = [];
    lines.forEach(({ comment }, i) => {
      const body = bodies[i];
      if (!body && !comment) {
        if (out.length && out[out.length - 1] !== "") out.push("");
        return;
      }
      const pad = "  ".repeat(indents[i]);
      out.push(pad + (body && comment ? `${body} ${comment}` : body || comment));
    });
    while (out.length && out[out.length - 1] === "") out.pop();
    return out.length ? out.join("\n") + "\n" : "";
  };
  const original = lines.map((l) => l.body);
  const formatted = original.map(formatBody);
  const want = fingerprint(source);
  let result = render(formatted);
  if (fingerprint(result) === want) return result;
  // Fall back line by line: keep each rewrite only if it preserves the meaning
  const safe = [...original];
  formatted.forEach((f, i) => {
    if (f === original[i]) return;
    const trial = [...safe];
    trial[i] = f;
    if (fingerprint(render(trial)) === want) safe[i] = f;
  });
  result = render(safe);
  return fingerprint(result) === want ? result : source;
}

/** Same comment rule as scan.ts: `#` at start or after whitespace, outside [...], {...}, labels and title */
function splitComment(raw: string): { body: string; comment: string } {
  const chars = [...raw];
  let start = 0;
  while (start < chars.length && (chars[start] === " " || chars[start] === "\t")) start++;
  const isTitle = /^(title|note)[ \t]/.test(chars.slice(start, start + 6).join(""));
  let depth = 0,
    inLabel = false,
    end = chars.length;
  for (let j = start; j < chars.length && !(isTitle && j > start); j++) {
    const c = chars[j];
    if (c === "[" || c === "{") depth++;
    else if ((c === "]" || c === "}") && depth > 0) depth--;
    else if (c === ":" && depth === 0) inLabel = true;
    else if (c === "#" && depth === 0 && !inLabel && (j === start || chars[j - 1] === " " || chars[j - 1] === "\t")) {
      end = j;
      break;
    }
  }
  return { body: chars.slice(start, end).join("").trimEnd(), comment: chars.slice(end).join("").trimEnd() };
}

const KEYWORD_LINE = /^(title|speed|wait|loop|branch|opt|else|end|note|pin|rank|group|diagram|theme)(\s|$)/;
const NEXT_EDGE = /^\s*[\p{L}\p{N}_-]+?(\[.*?\])?(\{[^}]*\})?\s*(-->|->|-x|~>)(\s|$)/u;

function formatBody(body: string): string {
  if (!body) return body;
  const m = body.match(KEYWORD_LINE);
  if (m) {
    const word = m[1],
      rest = body.slice(word.length).trim();
    if (word === "title" || word === "branch" || word === "opt" || word === "else" || word === "note")
      return rest ? `${word} ${rest}` : word;
    if (word === "group") return formatGroup(rest);
    return [word, ...rest.split(/\s+/).filter(Boolean)].join(" ");
  }
  if (body.startsWith("& ") || body.startsWith("&\t")) return `& ${formatEdges(body.slice(1).trim())}`;
  return formatEdges(body);
}

/** Split on ` & ` that starts another edge (same rule as the parser), format each edge */
function formatEdges(s: string): string {
  const t = [...s];
  const parts: string[] = [];
  let from = 0,
    depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "[" || c === "{") depth++;
    else if ((c === "]" || c === "}") && depth > 0) depth--;
    else if (
      depth === 0 &&
      c === "&" &&
      /\s/.test(t[i - 1] ?? "") &&
      /\s/.test(t[i + 1] ?? "") &&
      NEXT_EDGE.test(t.slice(i + 1).join(""))
    ) {
      parts.push(t.slice(from, i).join(""));
      from = i + 1;
    }
  }
  parts.push(t.slice(from).join(""));
  return parts.map((p) => formatEdge(p.trim())).join(" & ");
}

function formatEdge(s: string): string {
  // head = everything before the first ':' outside brackets; the label after it is kept verbatim (trimmed)
  const t = [...s];
  let depth = 0,
    colon = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "[" || t[i] === "{") depth++;
    else if ((t[i] === "]" || t[i] === "}") && depth > 0) depth--;
    else if (t[i] === ":" && depth === 0) {
      colon = i;
      break;
    }
  }
  const head = colon < 0 ? s : t.slice(0, colon).join("");
  const label =
    colon < 0
      ? ""
      : t
          .slice(colon + 1)
          .join("")
          .trim();
  const h = formatHead(head);
  if (colon < 0) return h;
  return label ? `${h} : ${label}` : `${h} :`;
}

/** `a[Label]{k:v}   ->b` → `a[Label]{k: v} -> b` (only outside brackets) */
function formatHead(head: string): string {
  const t = [...head.trim()];
  let out = "",
    depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "{" && depth === 0) {
      const close = t.indexOf("}", i);
      if (close < 0) return head.trim();
      out += `{${formatAttrs(t.slice(i + 1, close).join(""))}}`;
      i = close;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]" && depth > 0) depth--;
    if (depth > 0 || c === "]") {
      out += c;
      continue;
    }
    const arrow =
      c === "-" && t[i + 1] === "-" && t[i + 2] === ">"
        ? "-->"
        : c === "-" && t[i + 1] === ">"
          ? "->"
          : c === "~" && t[i + 1] === ">"
            ? "~>"
            : c === "-" &&
                t[i + 1] === "x" &&
                (i === 0 || /\s/.test(t[i - 1])) &&
                (i + 2 >= t.length || /\s/.test(t[i + 2]))
              ? "-x"
              : undefined;
    if (arrow) {
      out = out.trimEnd() + ` ${arrow} `;
      i += arrow.length - 1;
      continue;
    }
    if (/\s/.test(c)) {
      if (!out.endsWith(" ")) out += " ";
      continue;
    }
    out += c;
  }
  return out.trim();
}

function formatAttrs(s: string): string {
  return s
    .split(",")
    .map((p) => {
      const c = p.indexOf(":");
      return c < 0 ? p.trim() : `${p.slice(0, c).trim()}: ${p.slice(c + 1).trim()}`;
    })
    .join(", ");
}

/** `group id[Label]{..} in parent : a b c` */
function formatGroup(rest: string): string {
  const t = [...rest];
  let depth = 0,
    colon = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "[" || t[i] === "{") depth++;
    else if ((t[i] === "]" || t[i] === "}") && depth > 0) depth--;
    else if (t[i] === ":" && depth === 0) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return `group ${rest}`;
  const head = formatHead(t.slice(0, colon).join(""));
  const members = t
    .slice(colon + 1)
    .join("")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  return `group ${head} : ${members}`;
}

/** Meaning of a source: document without positions + diagnostic codes */
function fingerprint(src: string): string {
  const { doc, diagnostics } = parse(src);
  return JSON.stringify(
    { doc: { ...doc, nodes: [...doc.nodes.values()] }, codes: diagnostics.map((d) => d.code + JSON.stringify(d.args)) },
    (k, v) => (k === "span" ? undefined : v),
  );
}
