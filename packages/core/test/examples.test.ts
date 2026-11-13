import { readdirSync, readFileSync } from "node:fs";
import { parse, buildTimeline, formatAll } from "../src/index";
const dir = new URL("../examples/", import.meta.url);
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".ene"))
  .sort();
test("there are 16 examples", () => expect(files).toHaveLength(16));
test.each(files)("%s starts with a natural-language description", (f) => {
  const head = readFileSync(new URL(f, dir), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("# "))
    .map((l) => l.slice(2))
    .join(" ");
  expect(head.length).toBeGreaterThan(60);
});
test("together the examples cover every construct", () => {
  const all = files.map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
  for (const re of [
    / -> /,
    / --> /,
    / -x /,
    / & /,
    /^\s*& /m,
    /@[\d.]+s/,
    /^speed /m,
    /^\s*wait /m,
    /^\s*loop /m,
    /^\s*branch /m,
    /^\s*else /m,
    /^group .* in /m,
    /^pin /m,
    /^rank /m,
    /^diagram sequence/m,
    /icon: /,
    /shape: /,
    /color: /,
  ])
    expect(all).toMatch(re);
});
test.each(files)("%s parses cleanly and plays ≥3 steps", (f) => {
  const src = readFileSync(new URL(f, dir), "utf8");
  const { doc, diagnostics } = parse(src);
  expect(formatAll(src, diagnostics, "ko")).toBe("");
  expect(buildTimeline(doc).steps.length).toBeGreaterThanOrEqual(3);
});
