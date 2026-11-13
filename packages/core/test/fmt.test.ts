import { readdirSync, readFileSync } from "node:fs";
import { formatSource } from "../src/fmt";
import { parse } from "../src/parse";

const exDir = new URL("../examples/", import.meta.url).pathname;
const examples = readdirSync(exDir)
  .filter((f) => f.endsWith(".ene"))
  .map((f) => [f, readFileSync(exDir + f, "utf8")]);

test("normalizes spacing, indentation and attributes", () => {
  const src = [
    "title   Order  flow   # keep",
    "speed    1.2",
    "user[User]{shape:circle ,color:#f59e0b}->api[API]  :  POST /order",
    "branch   hit",
    "cache-->api:hit",
    "      else miss",
    "loop 2",
    "api   -x   db : retry   @2s",
    "    end",
    "end",
    "",
    "",
    "",
    "   # trailing comment",
    "api -> db   &   api -> log",
    "group  vpc[VPC]  :  user   api",
  ].join("\n");
  expect(formatSource(src)).toBe(
    [
      "title Order  flow   # keep",
      "speed 1.2",
      "user[User]{shape: circle, color: #f59e0b} -> api[API] : POST /order",
      "branch hit",
      "  cache --> api : hit",
      "else miss",
      "  loop 2",
      "    api -x db : retry   @2s",
      "  end",
      "end",
      "",
      "# trailing comment",
      "api -> db & api -> log",
      "group vpc[VPC] : user api",
      "",
    ].join("\n"),
  );
});
test("keeps comments and literal # in labels", () => {
  const src = "a->b   # real comment\na -> b : issue #12   # still label text\na[Tag #1] -> c";
  const out = formatSource(src);
  expect(out).toContain("a -> b # real comment");
  expect(out).toContain("a -> b : issue #12   # still label text");
  expect(out).toContain("a[Tag #1] -> c");
});
test("never changes meaning: unparsable or ambiguous lines are left alone", () => {
  const bad = "a ->\nfoo bar baz\n";
  expect(parse(formatSource(bad)).diagnostics.map((d) => d.code)).toEqual(parse(bad).diagnostics.map((d) => d.code));
  // `a-x b` is the id "a-x" followed by junk; must not become `a -x b`
  expect(formatSource("a-x b\n")).toBe("a-x b\n");
});
test.each(examples)("example %s: same meaning and idempotent", (_, src) => {
  const once = formatSource(src);
  expect(formatSource(once)).toBe(once);
  const strip = (s: string) =>
    JSON.stringify({ ...parse(s).doc, nodes: [...parse(s).doc.nodes.values()] }, (k, v) =>
      k === "span" ? undefined : v,
    );
  expect(strip(once)).toBe(strip(src));
});

test("preserves whitespace inside node and group labels while formatting their heads", () => {
  const src = "a[Two  words]->b\ngroup g[My  group] : a   b\n";
  expect(formatSource(src)).toBe("a[Two  words] -> b\ngroup g[My  group] : a b\n");
});
test("formats repeated labels without falling back on each line", () => {
  const src = "a[Two  words]->b\n".repeat(2000);
  expect(formatSource(src)).toBe("a[Two  words] -> b\n".repeat(2000));
});
