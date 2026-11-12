import { parse } from "../src/parse";
import { formatSource } from "../src/fmt";
import { formatDiagnostic } from "../src/format";

const codes = (src: string) => parse(src).diagnostics.map((d) => d.code);
const first = (src: string, code: string) => parse(src).diagnostics.find((d) => d.code === code)!;
const under = (src: string, code: string) => {
  const d = first(src, code);
  return [...src.split("\n")[d.span.line - 1]].slice(d.span.col - 1, d.span.col - 1 + d.span.length).join("");
};

describe("-x glued to an id (E113)", () => {
  test("glued to the source", () => { expect(codes("a-x b")).toEqual(["E113"]); expect(under("a-x b", "E113")).toBe("-x"); });
  test("glued to the target", () => { expect(codes("a -xb")).toEqual(["E113"]); expect(under("a -xb", "E113")).toBe("-x"); });
  test("with a label on the source the arrow is unambiguous", () => expect(codes("a[A] -x b")).toEqual([]));
  test("an id ending in -x still works with a real arrow", () => {
    const r = parse("proxy-x -> b\nb -x proxy-x");
    expect(r.diagnostics).toEqual([]);
    expect([...r.doc.nodes.keys()]).toEqual(["proxy-x", "b"]);
  });
  test("unrelated unknown statements keep E102", () => expect(codes("a b")).toEqual(["E102"]));
});

describe("# in labels (W105)", () => {
  test("spaced # after a label warns and stays in the label", () => {
    const r = parse("a -> b : hit # note");
    expect(r.diagnostics.map((d) => d.code)).toEqual(["W105"]);
    expect(under("a -> b : hit # note", "W105")).toBe("#");
    expect(r.doc.body[0]).toMatchObject({ edges: [{ label: "hit # note" }] });
  });
  test("unspaced # is plain text", () => expect(codes("a -> b : GET /items #1\na -> b : C#")).toEqual([]));
  test("# before any label is a comment", () => expect(codes("a -> b # note")).toEqual([]));
  test("title and branch labels", () => {
    expect(codes("title Flow # draft\na -> b")).toEqual(["W105"]);
    expect(under("title Flow # draft\na -> b", "W105")).toBe("#");
    expect(codes("branch a: b # c\n  a -> b\nend")).toEqual(["W105"]);
  });
  test("second parallel edge reports its own column", () => {
    const src = "a -> b : x & b -> c : y # z";
    expect(codes(src)).toEqual(["W105"]);
    expect(first(src, "W105").span.col).toBe(src.indexOf("#") + 1);
  });
});

describe("duration that is not last (W110)", () => {
  test("warns and keeps the text in the label", () => {
    const src = "a -> b : @2s slow";
    const r = parse(src);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["W110"]);
    expect(under(src, "W110")).toBe("@2s");
    expect(r.doc.body[0]).toMatchObject({ edges: [{ label: "@2s slow" }] });
    expect((r.doc.body[0] as { edges: { duration?: number }[] }).edges[0].duration).toBeUndefined();
  });
  test("a trailing duration is not flagged", () => expect(codes("a -> b : slow @2s")).toEqual([]));
  test("an email-like @ is not flagged", () => expect(codes("a -> b : mail to x@2s.io")).toEqual([]));
});

describe("ignored input warns", () => {
  test("W106 conflicting attribute on a later use", () => {
    const r = parse("a{shape: db} -> b\nb -> a{shape: queue}");
    expect(r.diagnostics[0]).toMatchObject({ code: "W106", args: { name: "a", attr: "shape", first: "db", second: "queue" } });
    expect(r.doc.nodes.get("a")!.shape).toBe("db");
  });
  test("W106 not raised for the same value or a new attribute", () =>
    expect(codes("a{shape: db} -> b\nb -> a{shape: db, color: red}")).toEqual([]));
  test("W107 repeated settings", () => {
    expect(codes("speed 1\na -> b\nspeed 2")).toEqual(["W107"]);
    expect(codes("title A\ntitle B\ndiagram flow\ndiagram sequence\na -> b")).toEqual(["W107", "W107"]);
    expect(parse("speed 1\na -> b\nspeed 2").doc.speed).toBe(2);
  });
  test("W108 text after end", () => {
    const src = "loop 2\n  a -> b\nend loop";
    expect(codes(src)).toEqual(["W108"]);
    expect(under(src, "W108")).toBe("loop");
  });
  test("W111 layout lines in a sequence diagram, wherever `diagram` is", () => {
    expect(codes("a -> b\npin a 0,0\nrank a b\ngroup g : a b\ndiagram sequence")).toEqual(["W111", "W111", "W111"]);
    expect(codes("a -> b\npin a 0,0\ngroup g : a b")).toEqual([]);
  });
  test("W112 node pinned twice", () => {
    const src = "a -> b\npin a 0,0\npin a 1,1";
    expect(codes(src)).toEqual(["W112"]);
    expect(under(src, "W112")).toBe("a");
  });
});

describe("keywords at line start", () => {
  test("E115 when a keyword is used as an edge source", () => {
    for (const k of ["end", "wait", "loop", "speed", "pin", "rank", "group", "diagram"])
      expect(parse(`a -> b\n${k} -> a : x`).diagnostics[0]).toMatchObject({ code: "E115", args: { keyword: k } });
  });
  test("E115 for `end` does not close the open block", () => expect(codes("loop 2\n  a -> b\n  end -> a\nend")).toEqual(["E115"]));
  test("W109 for title / branch / else, which keep their meaning", () => {
    const r = parse("title -> home\nbranch -> retry\n  a -> b\nelse -x fail\n  a -x b\nend");
    expect(r.diagnostics.map((d) => d.code)).toEqual(["W109", "W109", "W109"]);
    expect(r.doc.title).toBe("-> home");
  });
  test("a keyword after an arrow is a normal node id", () => expect(codes("a -> end\nend[End] -> a")).toEqual([]));
});

describe("attribute without a value (E114)", () => {
  test.each(["icon", "shape", "color"])("%s", (k) => {
    for (const src of [`a{${k}: } -> b`, `a{${k}} -> b`]) {
      expect(parse(src).diagnostics[0]).toMatchObject({ code: "E114", args: { name: k } });
      expect(under(src, "E114")).toBe(k);
    }
  });
});

describe("node declaration lines", () => {
  test("declare label and attributes without an edge, in order", () => {
    const r = parse("db[Orders DB]{shape: db}\nuser[User]\nq{shape: queue}\nuser -> db : q\ndb -> q");
    expect(r.diagnostics).toEqual([]);
    expect([...r.doc.nodes.values()].map((n) => [n.id, n.label, n.shape])).toEqual([["db", "Orders DB", "db"], ["user", "User", undefined], ["q", "q", "queue"]]);
    expect(r.doc.body).toHaveLength(2);
  });
  test("a bare id is still an unknown statement", () => expect(codes("a -> b\nbrnch")).toEqual(["E102"]));
  test("only declarations is still an empty diagram", () => expect(codes("a[A]\nb[B]")).toEqual(["E101"]));
  test("declared nodes can be pinned and grouped", () => expect(codes("a[A]\nb[B]\nc[C]\na -> b\ngroup g : b c\npin c 2,0")).toEqual([]));
  test("errors inside a declaration are reported once", () => {
    expect(codes("a[Open\nb -> c")).toEqual(["E105"]);
    expect(codes("a{shape: star}\nb -> c")).toEqual(["E110"]);
  });
  test("a declaration followed by an edge use is not a typo candidate", () =>
    expect(codes("cache[Cache]\ncach[Cach]\napi -> cache\napi -> cach")).toEqual([]));
  test("works inside blocks and keeps the block body intact", () => {
    const r = parse("loop 2\n  w[Worker]\n  w -> q\nend");
    expect(r.diagnostics).toEqual([]);
    expect(r.doc.body[0]).toMatchObject({ type: "loop", body: [{ type: "step" }] });
  });
  test("fmt keeps declaration lines and normalizes their attributes", () =>
    expect(formatSource("db[Orders DB]{shape:db,color:red}\n  user[User]\nuser->db")).toBe("db[Orders DB]{shape: db, color: red}\nuser[User]\nuser -> db\n"));
});

test("new diagnostics render with caret and hint in both languages", () => {
  const src = "a -> b : hit # note";
  expect(formatDiagnostic(src, parse(src).diagnostics[0], "en")).toBe(
`warning[W105]: this \`#\` is part of the label, not a comment
 --> line 1, col 14
  |
1 | a -> b : hit # note
  |              ^
  = hint: a comment cannot follow a label or title; move it to its own line, or ignore this if the \`#\` should be shown`);
  expect(formatDiagnostic("end -> a", parse("end -> a").diagnostics[0], "ko")).toContain("줄 맨 앞의 `end` 는 노드가 아니라 키워드예요");
});
