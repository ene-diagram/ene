import { readdirSync, readFileSync } from "node:fs";
import { parse, buildTimeline, formatAll } from "../src/index";
const dir = new URL("../examples/", import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith(".ene")).sort();
test("there are 10 examples", () => expect(files).toHaveLength(10));
test.each(files)("%s parses cleanly and plays ≥3 steps", (f) => {
  const src = readFileSync(new URL(f, dir), "utf8");
  const { doc, diagnostics } = parse(src);
  expect(formatAll(src, diagnostics, "ko")).toBe("");
  expect(buildTimeline(doc).steps.length).toBeGreaterThanOrEqual(3);
});
