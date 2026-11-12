import { fromMermaid } from "../src/mermaid";
import { parse } from "../src/parse";
import { buildTimeline } from "../src/timeline";

const clean = (source: string) => expect(parse(source).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
/** Converted lines after the review comment, node declarations and blank lines */
const edges = (src: string) => fromMermaid(src).source.split("\n").filter((l) => /\s(->|-->|-x)\s/.test(l));
const msgs = (src: string) => fromMermaid(src).warnings.map((w) => w.message);

test("nodes with labels and shapes, edges in source order, review note in the output", () => {
  const r = fromMermaid(`flowchart LR
  user((User)) -->|POST /order| api[Order API]
  api --> db[(Orders DB)]
  api --> s([Session]) & r(Rounded)
  x[["Sub"]] --> api`);
  expect(r.error).toBeUndefined();
  clean(r.source);
  expect(r.source.startsWith("# Converted from a Mermaid flowchart: each edge is one step, in source order.\n# A flowchart has no time axis, so review the step order.\n")).toBe(true);
  expect(r.source).toContain("user[User]{shape: circle}\napi[Order API]\ndb[Orders DB]{shape: db}\ns[Session]{shape: round}\nr[Rounded]{shape: round}\nx[Sub]\n");
  expect(r.source).not.toContain("diagram sequence");
  const { doc } = parse(r.source);
  expect(buildTimeline(doc).steps.map((s) => s.edges.map((e) => `${e.from}>${e.to}`).join())).toEqual(["user>api", "api>db", "api>s", "api>r", "x>api"]);
  expect(r.warnings).toEqual([
    { line: 1, message: "each link becomes one step in source order; a flowchart has no time axis, so review the order" },
    { line: 5, message: "the subroutine shape has no ene equivalent; drawn as a box" },
  ]);
});

test("link kinds and label forms", () => {
  expect(edges(`graph LR
  a -->|one| b
  a -- two --> c
  a -.-> d
  a -. three .-> e
  a ==> f
  a == four ==> g
  a --x h
  a ---> i
  a-->j-->k`)).toEqual([
    "a -> b : one", "a -> c : two", "a --> d", "a --> e : three", "a -> f", "a -> g : four", "a -x h", "a -> i", "a -> j", "j -> k",
  ]);
  expect(msgs("flowchart LR\n a --- b\n a --o c\n a <--> d\n a ~~~ e\n a e1@--> f")).toEqual([
    "each link becomes one step in source order; a flowchart has no time axis, so review the order",
    "links without an arrowhead are drawn as arrows",
    "circle arrowheads (`--o`) are drawn as plain arrows",
    "two-way links are drawn one way, from the first node",
    "invisible links (`~~~`) are dropped",
  ]);
  expect(edges("flowchart LR\n a e1@--> f")).toEqual(["a -> f"]);
});

test("subgraph → group; nested subgraph → group in parent with every member of its subtree", () => {
  const r = fromMermaid(`flowchart LR
  user --> api
  subgraph vpc [VPC]
    api --> db
    subgraph priv["Private Net"]
      db
      cache
    end
  end
  subgraph Other Things
    q
  end
  subgraph empty
  end
  api --> q`);
  clean(r.source);
  expect(r.source).toContain("group vpc[VPC] : api db cache\ngroup priv[Private Net] in vpc : db cache\ngroup Other_Things[Other Things] : q\n");
  expect(parse(r.source).doc.groups.map((g) => [g.id, g.parent, g.members])).toEqual([
    ["vpc", undefined, ["api", "db", "cache"]], ["priv", "vpc", ["db", "cache"]], ["Other_Things", undefined, ["q"]],
  ]);
  expect(r.warnings.find((w) => w.line === 13)?.message).toBe("a subgraph with no nodes is dropped");
});

test("dropped constructs warn with their line", () => {
  const r = fromMermaid(`flowchart TD
  a{Decide?} --> b:::hot
  style a fill:#f9f
  classDef hot fill:#f00
  click a "https://example.com"
  a --> sub
  subgraph sub
    direction LR
    c
  end
  c --> d{{Hex}}
  whatever ??`);
  clean(r.source);
  expect(r.warnings).toEqual([
    { line: 1, message: "each link becomes one step in source order; a flowchart has no time axis, so review the order" },
    { line: 1, message: "direction `TD` is ignored; ene lays out flows left to right" },
    { line: 2, message: "the rhombus shape has no ene equivalent; drawn as a box" },
    { line: 2, message: "`:::class` styles are dropped" },
    { line: 3, message: "styles and classes are dropped (and on 1 more line)" },
    { line: 5, message: "click handlers and links are dropped" },
    { line: 6, message: "links to a subgraph are dropped (ene groups cannot be edge ends)" },
    { line: 8, message: "`direction` inside a subgraph is ignored" },
    { line: 11, message: "the hexagon shape has no ene equivalent; drawn as a box" },
    { line: 12, message: "not converted: `whatever ??`" },
  ]);
  expect(r.source).toContain("a[Decide?]\nb[b]\n");
  expect(r.source).not.toContain("whatever");
});

test("new shape syntax, quoted and markdown labels, keyword ids, label adjustments", () => {
  const r = fromMermaid(`flowchart LR
  c@{ shape: cyl, label: "Cache" } --> end_["\`**Done** now\`"]
  note --> loop
  a -->|ping @all| b`);
  clean(r.source);
  expect(r.source).toContain("c[Cache]{shape: db}\nend_[Done now]\nnote_[note]\nloop_[loop]\n");
  expect(r.source).toContain("a -> b : ping ＠all");
  expect(r.warnings.map((w) => w.line)).toEqual([1, 4]);
});

test("errors and fences: no links, ```mermaid flowchart in Markdown", () => {
  expect(fromMermaid("flowchart LR\n a[A]\n b")).toMatchObject({ source: "", error: "the flowchart has no links to play" });
  const md = "# Doc\n\n```mermaid\ngraph\n a-->b\n```\n";
  expect(fromMermaid(md).source).toContain("a -> b");
});

test("quoted labels keep ; | and line breaks; redeclaring a node resets its shape", () => {
  const r = fromMermaid('flowchart LR\n A["Hello; world"] --> B\n A -->|"yes | no"| C\n D["two\n lines"] --> B\n B((Old)) --> E\n B[New] --> F\n E{{Hex}} --> F');
  clean(r.source);
  expect(r.source).toContain("A[Hello; world]\nB[New]\nC[C]\nD[two lines]\nE[Hex]\nF[F]\n");
  expect(r.source).toContain("A -> B\nA -> C : yes | no\nD -> B\nB -> E\nB -> F\nE -> F");
  expect(r.warnings.map((w) => w.line)).toEqual([1, 8]);
});
