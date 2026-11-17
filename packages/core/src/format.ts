import { DID_YOU_MEAN, MESSAGES, fill, type Code, type Lang } from "./diagnostics.js";
import type { Diagnostic } from "./types.js";

export function formatDiagnostic(source: string, d: Diagnostic, lang: Lang = "en"): string {
  const m = MESSAGES[lang][d.code as Code];
  // A problem in an included file carries its own line: `source` is the file that has the `include`
  const raw = d.file !== undefined ? (d.lineText ?? "") : (source.split(/\r\n|\r|\n/)[d.span.line - 1] ?? "");
  const where = d.file !== undefined ? `${d.file}, ` : "";
  const g = String(d.span.line).length;
  const pad = " ".repeat(g);
  // Keep tabs in the source as-is so the ^ stays aligned
  const lead = [...raw]
    .slice(0, d.span.col - 1)
    .map((c) => (c === "\t" ? "\t" : " "))
    .join("");
  const hint = d.args.suggestion ? fill(DID_YOU_MEAN[lang], d.args) : fill(m.hint, d.args);
  return [
    `${d.severity}[${d.code}]: ${fill(m.message, d.args)}`,
    `${pad}--> ${where}line ${d.span.line}, col ${d.span.col}`,
    `${pad} |`,
    `${d.span.line} | ${raw}`,
    `${pad} | ${lead}${"^".repeat(Math.max(1, d.span.length))}`,
    `${pad} = hint: ${hint}`,
  ].join("\n");
}

export const formatAll = (source: string, ds: Diagnostic[], lang: Lang = "en") =>
  ds.map((d) => formatDiagnostic(source, d, lang)).join("\n\n");

/** Machine-readable diagnostic (for `ene check --json` and tools/agents) */
export interface DiagnosticJson {
  code: string;
  severity: Diagnostic["severity"];
  line: number;
  col: number;
  length: number;
  message: string;
  hint: string;
  suggestion?: string;
  /** Only for a problem in an included file: that file (line and col are in it) */
  file?: string;
}
export function diagnosticToJson(d: Diagnostic, lang: Lang = "en"): DiagnosticJson {
  const m = MESSAGES[lang][d.code as Code];
  const hint = d.args.suggestion ? fill(DID_YOU_MEAN[lang], d.args) : fill(m.hint, d.args);
  const j: DiagnosticJson = {
    code: d.code,
    severity: d.severity,
    line: d.span.line,
    col: d.span.col,
    length: d.span.length,
    message: fill(m.message, d.args),
    hint,
  };
  if (d.args.suggestion) j.suggestion = d.args.suggestion;
  if (d.file !== undefined) j.file = d.file;
  return j;
}
