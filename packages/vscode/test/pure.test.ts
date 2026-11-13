import { parse } from "@ene-diagram/core";
import { readFileSync } from "node:fs";
import {
  cpColToUtf16,
  formatEdit,
  parseWebviewMessage,
  previewHtml,
  quickFixEdit,
  spanToRange,
  splitLines,
  toEditorDiagnostics,
} from "../src/pure.js";

const apply = (
  text: string,
  e: {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  },
) => {
  const lines = splitLines(text);
  const { start, end } = e.range;
  const head = lines.slice(0, start.line).concat(lines[start.line].slice(0, start.character)).join("\n");
  const tail = [lines[end.line].slice(end.character), ...lines.slice(end.line + 1)].join("\n");
  return head + e.newText + tail;
};

describe("range mapping", () => {
  it("converts code-point columns to UTF-16 offsets", () => {
    expect(cpColToUtf16("abc", 1)).toBe(0);
    expect(cpColToUtf16("abc", 3)).toBe(2);
    expect(cpColToUtf16("😀x", 2)).toBe(2); // astral char is two UTF-16 units
    expect(cpColToUtf16("주문 x", 4)).toBe(3);
    expect(cpColToUtf16("ab", 10)).toBe(2); // clamped
  });
  it("maps spans to 0-based ranges", () => {
    expect(spanToRange(["a -> b", "😀 -> c"], { line: 2, col: 3, length: 2 })).toEqual({
      start: { line: 1, character: 3 },
      end: { line: 1, character: 5 },
    });
  });
  it("never yields an empty range and clamps the line", () => {
    const r = spanToRange(["a ->"], { line: 5, col: 5, length: 1 });
    expect(r.start.line).toBe(0);
    expect(r.end.character).toBeGreaterThanOrEqual(r.start.character);
  });
  it("maps a real diagnostic after astral characters", () => {
    const text = "😀[Smile] -> b\n😀 -> end2\nb ->";
    const ds = toEditorDiagnostics(text, parse(text).diagnostics);
    const e103 = ds.find((d) => d.code === "E103")!;
    expect(e103.range.start.line).toBe(2);
    expect(e103.severity).toBe("error");
  });
});

describe("quick fixes", () => {
  it("fixes a misspelt keyword (E102)", () => {
    const text = "a -> b\n  lop 2\n  a -> b\nend";
    const ds = toEditorDiagnostics(text, parse(text).diagnostics);
    const d = ds.find((x) => x.suggestion)!;
    expect(d.suggestion).toBe("loop");
    const fix = quickFixEdit(splitLines(text), d)!;
    expect(apply(text, fix)).toBe("a -> b\n  loop 2\n  a -> b\nend");
  });
  it("fixes a node typo (W101)", () => {
    const text = "api[API] -> db\ndb --> apii : rows";
    const ds = toEditorDiagnostics(text, parse(text).diagnostics);
    const d = ds.find((x) => x.code === "W101")!;
    expect(d.suggestion).toBe("api");
    expect(apply(text, quickFixEdit(splitLines(text), d)!)).toBe("api[API] -> db\ndb --> api : rows");
  });
  it("offers nothing when the text under the diagnostic changed since it was computed", () => {
    const text = "api[API] -> db\ndb --> apii : rows";
    const d = toEditorDiagnostics(text, parse(text).diagnostics).find((x) => x.code === "W101")!;
    expect(d.target).toBeTruthy();
    expect(quickFixEdit(splitLines("api[API] -> db\nxx db --> apii : rows"), d)).toBeUndefined();
  });
  it("returns nothing without a suggestion", () => {
    const text = "a ->";
    const [d] = toEditorDiagnostics(text, parse(text).diagnostics);
    expect(quickFixEdit(splitLines(text), d)).toBeUndefined();
  });
});

describe("formatting edit", () => {
  it("replaces the whole document only when it changes", () => {
    expect(formatEdit("a", "a")).toBeUndefined();
    const e = formatEdit("x\nyy", "z")!;
    expect(e.range.end).toEqual({ line: 1, character: 2 });
  });
});

describe("webview", () => {
  it("accepts only known messages", () => {
    expect(parseWebviewMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseWebviewMessage({ type: "error", message: 1 })).toBeUndefined();
    expect(parseWebviewMessage({ type: "eval", code: "x" })).toBeUndefined();
    expect(parseWebviewMessage(null)).toBeUndefined();
  });
  it("has a strict CSP without remote sources or unsafe-eval", () => {
    const html = previewHtml({
      cspSource: "vscode-resource:",
      nonce: "N",
      playerUri: "u1",
      elkUri: 'u"2',
      scriptUri: "u3",
      lang: "en",
    });
    const csp = /Content-Security-Policy" content="([^"]*)"/.exec(html)![1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-N' vscode-resource:");
    expect(csp).not.toMatch(/https?:|unsafe-eval|\*/);
    expect(html).not.toContain('u"2');
    for (const m of html.matchAll(/<script\b[^>]*>/g)) expect(m[0]).toContain('nonce="N"');
  });
});

describe("grammar", () => {
  it("is valid JSON with the documented repository entries", () => {
    const g = JSON.parse(readFileSync(new URL("../syntaxes/ene.tmLanguage.json", import.meta.url), "utf8"));
    expect(g.scopeName).toBe("source.ene");
    for (const k of ["keywords", "arrows", "comment", "label", "attrs"]) expect(g.repository[k]).toBeDefined();
    const kw = new RegExp(g.repository.keywords.match);
    expect(kw.test("  loop 3")).toBe(true);
    expect(kw.test("loopy -> a")).toBe(false);
  });
});
