// Pure helpers shared by the extension; no `vscode` import so they can be unit-tested with vitest.
import { diagnosticToJson, type Diagnostic, type Lang } from "@ene-diagram/core";

export interface Pos { line: number; character: number } // 0-based, UTF-16 (VS Code)
export interface Rng { start: Pos; end: Pos }

/** Convert a 1-based code-point column on `lineText` to a 0-based UTF-16 offset. */
export function cpColToUtf16(lineText: string, col: number): number {
  let cp = 0, i = 0;
  while (cp < col - 1 && i < lineText.length) {
    const c = lineText.codePointAt(i)!;
    i += c > 0xffff ? 2 : 1;
    cp++;
  }
  return i;
}

export const splitLines = (text: string) => text.split(/\r\n|\r|\n/);

/** Map an ene diagnostic span (1-based line/col, length in code points) to a VS Code range. */
export function spanToRange(lines: string[], span: { line: number; col: number; length: number }): Rng {
  const line = Math.min(Math.max(span.line - 1, 0), Math.max(lines.length - 1, 0));
  const text = lines[line] ?? "";
  const start = cpColToUtf16(text, span.col);
  let end = cpColToUtf16(text, span.col + Math.max(1, span.length));
  if (end <= start) end = Math.min(text.length, start + 1); // e.g. "missing target" at end of line
  return { start: { line, character: start }, end: { line, character: end } };
}

export interface EneDiag { range: Rng; severity: "error" | "warning"; code: string; message: string; suggestion?: string; target?: string }

/** Diagnostics ready for the editor: message + hint, range and the token a quick fix replaces. */
export function toEditorDiagnostics(text: string, diags: Diagnostic[], lang: Lang = "en"): EneDiag[] {
  const lines = splitLines(text);
  return diags.map((d) => {
    const j = diagnosticToJson(d, lang);
    const out: EneDiag = { range: spanToRange(lines, d.span), severity: d.severity, code: d.code, message: `${j.message}\n${j.hint}` };
    if (j.suggestion) {
      out.suggestion = j.suggestion;
      out.target = d.args.name ?? d.args.word?.split(/\s/, 1)[0];
    }
    return out;
  });
}

/**
 * Range a "did you mean" quick fix replaces: the misspelt token at the start of the span when it is there,
 * otherwise the whole span. Returns undefined when the diagnostic has no suggestion.
 */
export function quickFixEdit(lines: string[], d: EneDiag): { range: Rng; newText: string } | undefined {
  if (!d.suggestion) return undefined;
  const { start } = d.range;
  const text = lines[start.line] ?? "";
  if (d.target) {
    // The text no longer holds the word the diagnostic was about: don't guess, offer nothing
    if (!text.startsWith(d.target, start.character)) return undefined;
    return { range: { start, end: { line: start.line, character: start.character + d.target.length } }, newText: d.suggestion };
  }
  return { range: d.range, newText: d.suggestion };
}

/** Full-document replacement for formatting, or undefined when already formatted. */
export function formatEdit(text: string, formatted: string): { range: Rng; newText: string } | undefined {
  if (formatted === text) return undefined;
  const lines = splitLines(text);
  const last = lines.length - 1;
  return { range: { start: { line: 0, character: 0 }, end: { line: last, character: lines[last].length } }, newText: formatted };
}

/** Accept only well-formed messages from the webview. */
export type WebviewMessage = { type: "ready" } | { type: "error"; message: string };
export function parseWebviewMessage(m: unknown): WebviewMessage | undefined {
  if (!m || typeof m !== "object") return undefined;
  const t = (m as { type?: unknown }).type;
  if (t === "ready") return { type: "ready" };
  if (t === "error" && typeof (m as { message?: unknown }).message === "string") return { type: "error", message: (m as { message: string }).message.slice(0, 500) };
  return undefined;
}

export function nonce(): string {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/** HTML for the preview webview. `cspSource` and URIs come from the VS Code webview API. */
export function previewHtml(o: { cspSource: string; nonce: string; playerUri: string; elkUri: string; scriptUri: string; lang: Lang }): string {
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${o.nonce}' ${o.cspSource}`,
    `style-src ${o.cspSource} 'unsafe-inline'`, // the player injects <style> elements
    `img-src ${o.cspSource} data:`,
    `font-src ${o.cspSource}`,
  ].join("; ");
  const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!DOCTYPE html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attr(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{padding:16px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}
#root .ene-player{display:flex}
body.vscode-light svg{--bg:#fbfcfd;--node:#fff;--line:#c1c8d2;--faint:#d9dde3;--fg:#1c2024;--fg2:#3a4048;--ok:#3e63dd;--fail:#e5484d;--reply:#30a46c}
body.vscode-dark svg,body.vscode-high-contrast:not(.vscode-high-contrast-light) svg{--bg:#111113;--node:#1c1d21;--line:#3b3e45;--faint:#2e3036;--fg:#edeef0;--fg2:#b0b4ba;--ok:#7b9bff;--fail:#ff6369;--reply:#4cc38a}
body .ene-bar{color:var(--vscode-foreground)}
body .ene-bar button,body .ene-bar select{background:var(--vscode-button-secondaryBackground,#fff);color:var(--vscode-button-secondaryForeground,#1c2024);border-color:var(--vscode-widget-border,#c1c8d2)}
body .ene-error{color:var(--vscode-errorForeground);background:var(--vscode-inputValidation-errorBackground);border-color:var(--vscode-inputValidation-errorBorder)}
</style>
<script nonce="${o.nonce}">window.eneConfig = { startOnLoad: false, lang: "${o.lang}", elkUrl: "${attr(o.elkUri)}" };</script>
<script nonce="${o.nonce}" src="${attr(o.playerUri)}"></script>
</head>
<body>
<div id="root"></div>
<script nonce="${o.nonce}" src="${attr(o.scriptUri)}"></script>
</body>
</html>`;
}
