import { fromMermaid } from "../src/mermaid";
import { parse } from "../src/parse";
import { buildTimeline } from "../src/timeline";

const conv = (src: string) => fromMermaid(`sequenceDiagram\n${src}`);
const body = (src: string) => { const r = conv(src); expect(r.error).toBeUndefined(); return r.source.split("\n\n").slice(2).join("\n\n").trimEnd(); };
const clean = (source: string) => expect(parse(source).diagnostics.filter((d) => d.severity === "error")).toEqual([]);

test("messages, participants and arrows", () => {
  const r = conv(`
    participant A as Alice
    actor B as Bob
    A->>B: hello
    B-->>A: hi
    A-xB: lost
    A--xB: lost reply
    A-)B: async
    B--)A: async reply
    A->B: plain
    B-->A: plain reply`);
  expect(r.warnings).toEqual([]);
  expect(r.source).toBe(`diagram sequence

A[Alice]
B[Bob]{shape: circle}

A -> B : hello
B --> A : hi
A -x B : lost
A -x B : lost reply
A ~> B : async
B --> A : async reply
A -> B : plain
B --> A : plain reply
`);
  clean(r.source);
});

test("participant order follows first appearance, declared or implicit", () => {
  const r = conv("participant C\nA->>B: x\nB->>C: y");
  expect([...parse(r.source).doc.nodes.keys()]).toEqual(["C", "A", "B"]);
});

test("names that are not ene ids get an id and keep their name as the label", () => {
  const r = conv("Order Service->>결제 서버: pay\nend user->>loop: x\nparticipant a.b\nparticipant a b\nA[1]->>Order Service: y");
  clean(r.source);
  const nodes = [...parse(r.source).doc.nodes.values()].map((n) => [n.id, n.label]);
  expect(nodes).toEqual([["Order_Service", "Order Service"], ["결제_서버", "결제 서버"], ["end_user", "end user"], ["loop_", "loop"], ["a_b", "a.b"], ["a_b_2", "a b"], ["A_1", "A(1)"]]);
});

test("title from front matter or a title line, comments kept, directives dropped", () => {
  const r = fromMermaid(`---\ntitle: "Checkout"\nconfig:\n  theme: dark\n---\n%%{init: {"theme": "dark"}}%%\nsequenceDiagram\n  %% first call\n  A->>B: x`);
  expect(r.source).toContain("title Checkout\n");
  expect(r.source).toContain("# first call\nA -> B : x");
  expect(conv("title: Login\nA->>B: x").source).toContain("title Login\n");
});

test("alt / else becomes branch / else", () => {
  expect(body("A->>B: get\nalt hit\n B-->>A: value\nelse miss\n B-->>A: nil\nelse\n B-xA: down\nend")).toBe(
`A -> B : get
branch hit
  B --> A : value
else miss
  B --> A : nil
else else 2
  B -x A : down
end`);
});

test("opt and break become ene opt; empty alt arms get `wait 0`", () => {
  const r = conv("opt notify\n A->>B: email\nend\nalt a\n A->>B: x\nelse b\n Note over A: nothing\nend\nbreak\n A-)B: fire\nend\nopt empty\nend");
  clean(r.source);
  expect(r.source).toContain("opt notify\n  A -> B : email\nend");
  expect(r.source).toContain("else b\n  # note: nothing\n  wait 0\nend");
  expect(r.source).toContain("opt\n  A ~> B : fire\nend\n");
  expect(r.source).not.toContain("opt empty");
  const tl = buildTimeline(parse(r.source).doc, { choices: [1, 1, 1] });
  expect(tl.steps).toHaveLength(0);
  expect(tl.branches.map((b) => [b.arms, b.optional])).toEqual([[["notify", "skip"], true], [["a", "b"], undefined], [["", "skip"], true]]);
});

test("loop takes a count from its label, or 2 with a warning", () => {
  expect(body("loop retry 3 times\n A->>B: x\nend")).toBe("# loop: retry 3 times\nloop 3\n  A -> B : x\nend");
  const r = conv("loop every minute\n A->>B: x\nend");
  expect(r.source).toContain("# loop: every minute\nloop 2\n");
  expect(r.warnings).toEqual([{ line: 2, message: "loop `every minute` has no repeat count in Mermaid; set to `loop 2`" }]);
});

test("par with one message per arm is one step; otherwise arms play in order with a warning", () => {
  expect(body("par a\n A->>B: x\nand b\n A->>C: y\nend")).toBe("A -> B : x & A -> C : y");
  expect(parse(conv("par a\n A->>B: x\nand b\n A->>C: y\nend").source).doc.body).toHaveLength(1);
  const r = conv("par a\n A->>B: x\n B-->>A: ok\nand b\n A->>C: y\nend");
  expect(r.source).toContain("# par: a\nA -> B : x\nB --> A : ok\n# par: b\nA -> C : y");
  expect(r.warnings[0]).toMatchObject({ line: 2 });
});

test("blocks without a step are dropped; rect and box keep their contents", () => {
  expect(body("A->>B: x\nalt a\n Note over A: n\nend\nloop 2\nend\nrect rgb(0,0,0)\n B-->>A: y\nend")).toBe("A -> B : x\nB --> A : y");
  const r = conv("box Aqua Front\n participant A\n participant B\nend\nA->>B: x");
  expect(r.source).toContain("A[A]\nB[B]\n\nA -> B : x");
  expect(r.warnings.map((w) => w.line)).toEqual([2]);
});

test("unsupported constructs warn with the source line, grouped by kind", () => {
  const r = conv("A->>+B: x\nactivate B\nNote right of B: think\nNote over A,B: both\ndeactivate B\nB-->>-A: y\nlink A: Dashboard @ https://x\nwhatever this is");
  expect(r.warnings).toEqual([
    { line: 2, message: "activation bars are not drawn (and on 3 more lines)" },
    { line: 8, message: "participant links and properties are dropped" },
    { line: 9, message: "not converted: `whatever this is`" },
  ]);
  expect(r.source).toContain("A -> B : x\nnote think\nnote both\nB --> A : y");
});

test("message text that would change meaning in ene is adjusted and reported", () => {
  const r = conv("A->>B: ping @all\nA->>B: x & B -> A : y\nA->>B: cost #35;1 #amp; more<br/>lines\nalt retry #2\n A->>B: z\nend");
  clean(r.source);
  const labels = parse(r.source).doc.body.flatMap((s) => (s.type === "step" ? s.edges.map((e) => e.label) : s.type === "branch" ? [s.arms[0].label] : []));
  expect(labels).toEqual(["ping ＠all", "x ＆ B -> A : y", "cost #1 & more lines", "retry ＃2"]);
  expect(r.warnings.map((w) => w.line)).toEqual([2, 3, 5]);
});

test("`;` separates statements, but an entity keeps its own and comments are left alone", () => {
  expect(body("A->>B: one;\nA->>B: semi #59;")).toBe("A -> B : one\nA -> B : semi ;");
  expect(body("A->>B: hello; B-->>A: reply;; alt ok; A->>B: #59;x#59; y; end")).toBe("A -> B : hello\nB --> A : reply\nbranch ok\n  A -> B : ;x; y\nend");
  expect(body("%% a; b\nA->>B: x")).toBe("# a; b\nA -> B : x");
  const r = fromMermaid("sequenceDiagram; A->>B: hello; activate B");
  expect(r.source).toContain("A -> B : hello");
  expect(r.warnings).toEqual([{ line: 1, message: "activation bars are not drawn" }]);
});

test("unclosed and stray blocks", () => {
  const r = conv("end\nalt a\n A->>B: x\nelse b\n A->>B: y\nand c");
  clean(r.source);
  expect(r.source).toContain("branch a\n  A -> B : x\nelse b\n  A -> B : y\nend");
  expect(r.warnings.map((w) => [w.line, w.message.split(" ")[0]])).toEqual([[2, "`end`"], [3, "`alt`"], [7, "`and`"]]);
});

test("a ```mermaid fence in Markdown is unwrapped, with line numbers from the file", () => {
  const md = "# Doc\n\n```mermaid\nflowchart LR\n a-->b\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: x\n  activate B\n```\n";
  const r = fromMermaid(md);
  expect(r.source).toContain("A -> B : x");
  expect(r.warnings).toEqual([{ line: 11, message: "activation bars are not drawn" }]);
});

test("errors: other diagram kinds, empty input, no messages, nesting beyond the ene limit", () => {
  expect(fromMermaid("flowchart LR\n a-->b")).toMatchObject({ source: "", error: "only `sequenceDiagram` can be converted (found `flowchart`)" });
  expect(fromMermaid("\n")).toMatchObject({ source: "", error: "no Mermaid diagram found" });
  expect(conv("participant A\nNote over A: x")).toMatchObject({ source: "", error: "the diagram has no messages to play" });
  const deep = conv(`${"opt x\n".repeat(40)}A->>B: y\n${"end\n".repeat(40)}`);
  expect(deep.error).toMatch(/^the converted source has an error on line \d+: blocks are nested more than 32 levels deep$/);
  expect(deep.source).toContain("A -> B : y");
});

test("participant configuration: type becomes a shape, alias becomes the label", () => {
  const r = conv(`participant D@{ "type": "database", "alias": "My DB" }\nparticipant Q@{ "type": "queue" } as Jobs\nparticipant C@{ "type": "control" }\nD->>Q: x\nQ->>C: y`);
  expect(r.source).toContain("D[My DB]{shape: db}\nQ[Jobs]{shape: queue}\nC[C]\n");
  expect(r.warnings).toEqual([{ line: 4, message: "participant type `control` has no ene shape; drawn as a box" }]);
});

test("notes become step notes on the message above; orphan notes stay comments", () => {
  const r = conv("Note over A: intro\nA->>B: get\nNote right of B: cache first, TTL 60s\npar a\n A->>B: x\n Note over B: in par\nand b\n A->>C: y\nend\nNote over A:\nloop 2\n A->>B: z\nend\nNote over A: after loop");
  clean(r.source);
  expect(r.source).toContain("# note: intro\nA -> B : get\nnote cache first, TTL 60s\n");
  expect(r.source).toContain("A -> B : x & A -> C : y\nnote in par\n");
  expect(r.source).toContain("end\n# note: after loop");
  const steps = buildTimeline(parse(r.source).doc).steps;
  expect(steps[0].note).toBe("cache first, TTL 60s");
  expect(steps[1].note).toBe("in par");
  expect(r.warnings.map((w) => w.message)).toEqual([
    "a note with no message right above it is kept as a comment (and on 1 more line)",
    "empty note is dropped",
  ]);
});

test("note text that would read as an edge is adjusted", () => {
  const r = conv("A->>B: x\nNote over A: -> next\npar a\n A->>B: y\n Note over B: -x z\nand b\n A->>C: w\nend");
  clean(r.source);
  expect(r.error).toBeUndefined();
  expect(r.source).toContain("note ‐> next");
  expect(r.source).toContain("note ‐x z");
  expect(r.warnings.map((w) => w.line)).toEqual([3, 6]);
});
