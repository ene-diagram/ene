import { DID_YOU_MEAN, MESSAGES, fill, type Code, type Lang } from "./diagnostics.js";
import type { Diagnostic } from "./types.js";

export function formatDiagnostic(source: string, d: Diagnostic, lang: Lang = "en"): string {
  const m = MESSAGES[lang][d.code as Code];
  const raw = source.split(/\r\n|\r|\n/)[d.span.line - 1] ?? "";
  const g = String(d.span.line).length;
  const pad = " ".repeat(g);
  // 원문의 탭은 그대로 두어 ^ 정렬을 맞춘다
  const lead = [...raw].slice(0, d.span.col - 1).map((c) => (c === "\t" ? "\t" : " ")).join("");
  const hint = d.args.suggestion ? fill(DID_YOU_MEAN[lang], d.args) : fill(m.hint, d.args);
  return [
    `${d.severity}[${d.code}]: ${fill(m.message, d.args)}`,
    `${pad}--> line ${d.span.line}, col ${d.span.col}`,
    `${pad} |`,
    `${d.span.line} | ${raw}`,
    `${pad} | ${lead}${"^".repeat(Math.max(1, d.span.length))}`,
    `${pad} = hint: ${hint}`,
  ].join("\n");
}

export const formatAll = (source: string, ds: Diagnostic[], lang: Lang = "en") =>
  ds.map((d) => formatDiagnostic(source, d, lang)).join("\n\n");
