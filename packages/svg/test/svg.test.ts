import { parse, buildTimeline, enumeratePaths } from "@ene-diagram/core";
import { layout, layoutSequence } from "@ene-diagram/layout";
import {
  pathsSeconds,
  renderSvg,
  renderSvgPaths,
  svgParts,
  themeCss,
  THEMES,
  THEME_VARS,
  type ThemeName,
} from "../src/index";
const make = async (src: string) => {
  const { doc } = parse(src);
  const tl = buildTimeline(doc);
  return renderSvg(await layout(doc, tl), tl, { title: doc.title });
};
test("well-formed XML with escaped labels", async () => {
  const svg = await make(`title A & B <x>\nu[<user> & "me"] -> api : a < b & c\napi --> u : ok`);
  expect(svg).toContain("&lt;user&gt; &amp; &quot;me&quot;");
  expect(svg).not.toMatch(/<user>/);
  // 태그 균형 대략 검사
  const open = (svg.match(/<[a-zA-Z]+(\s[^>]*)?(?<!\/)>/g) ?? []).length;
  const close = (svg.match(/<\/[a-zA-Z]+>/g) ?? []).length;
  expect(open).toBe(close);
});
test("one moving dot per timeline edge", async () => {
  const svg = await make("a -> b\nb -> c & b -> d\nd -x a");
  expect(svg.match(/<animateMotion/g)).toHaveLength(4);
});
test("reply is dashed, fail shows cross", async () => {
  const svg = await make("a -> b\nb --> a\nb -x a");
  expect(svg).toContain('class="hl reply"');
  expect(svg).toContain("✕");
});
test("accessibility and preferences", async () => {
  const svg = await make("title 주문\nuser -> api : POST\napi --> user : 201");
  expect(svg).toContain("<title>주문</title>");
  expect(svg).toMatch(/<desc>[^<]*1\. user → api: POST[^<]*2\. api → user: 201/);
  expect(svg).toContain("prefers-reduced-motion");
  expect(svg).toContain("prefers-color-scheme: dark");
});

describe("themes", () => {
  const doc = parse("a -> b").doc,
    tl = buildTimeline(doc);
  const out = (theme?: ThemeName) => renderSvg(layoutSequence(doc, tl), tl, { theme });
  it("tags the root and emits that theme's variables with a dark variant", () => {
    for (const t of THEMES) {
      const svg = out(t);
      expect(svg).toContain(`class="ene ene-theme-${t}"`);
      expect(svg).toContain(`svg.ene-theme-${t}{--bg:${THEME_VARS[t].light.bg}`);
      expect(svg).toContain(`@media (prefers-color-scheme: dark){svg.ene-theme-${t}{--bg:${THEME_VARS[t].dark.bg}`);
    }
  });
  it("scopes inline rules to the theme class with zero specificity", () => {
    expect(themeCss("mono")).toMatch(/^:where\(svg\.ene-theme-mono\)\{--bg:/);
  });
  it("scopes exported rules to the theme class so inline exports don't restyle each other", () => {
    const a = out("mono"),
      b = out("high-contrast");
    expect(a).not.toMatch(/(^|[;}\s])svg\{--/);
    expect(b).toContain("svg.ene-theme-high-contrast{--bg:");
  });
  it("falls back to default for no or unknown theme", () => {
    expect(out()).toContain("ene-theme-default");
    expect(out("nope" as ThemeName)).toContain("ene-theme-default");
  });
});
test("step notes are a caption under the diagram, shown while their step plays; notes: false omits them", async () => {
  const src = "a -> b : one\nnote first <why>\nb -> c : two\nc --> a : three\nnote third";
  const { doc } = parse(src);
  const tl = buildTimeline(doc);
  const l = await layout(doc, tl);
  const svg = renderSvg(l, tl);
  const notes = [...svg.matchAll(/class="note"[^>]*><tspan[^>]*>([^<]*)/g)].map((m) => m[1]);
  expect(notes).toEqual(["first &lt;why&gt;", "third"]);
  expect(svg).toContain(`height="${l.height + 40}"`);
  expect(svg).toContain("(first &lt;why&gt;)");
  const plain = renderSvg(l, tl, { notes: false });
  expect(plain).not.toContain('class="note"');
  expect(plain).toContain(`height="${l.height}"`);
  expect(renderSvg(l, buildTimeline(parse("a -> b").doc))).not.toContain('class="note"');
});
test("long notes wrap to the diagram width and grow the caption", async () => {
  const { wrapNote } = await import("../src/index");
  const long =
    "This explanation is much longer than a small two node diagram is wide, so it has to wrap onto more lines";
  const lines = wrapNote(long, 200);
  expect(lines.length).toBeGreaterThan(2);
  expect(lines.join(" ")).toBe(long);
  expect(wrapNote("x".repeat(100), 100).join("")).toBe("x".repeat(100));
  const { doc } = parse(`a -> b\nnote ${long}`);
  const tl = buildTimeline(doc);
  const l = await layout(doc, tl);
  const svg = renderSvg(l, tl);
  const n = wrapNote(long, l.width - 80).length;
  expect(n).toBeGreaterThan(1);
  expect(svg.match(/<tspan/g)).toHaveLength(n);
  expect(svg).toContain(`height="${l.height + 22 + 18 * n}"`);
});
test("async edges get their own style", async () => {
  const svg = await make("a ~> q : publish\na -> b");
  expect(svg).toContain('class="hl async"');
  expect(svg).toContain('class="dot async"');
  expect(svg).toContain(".hl.async{");
  expect(svg).toContain("a → q: publish (async)");
});
test("desc marks failed calls in the chosen language", async () => {
  const { doc } = parse("a -x b");
  const tl = buildTimeline(doc);
  const lay = await layout(doc, tl);
  expect(renderSvg(lay, tl)).toMatch(/<desc>[^<]*a → b \(fail\)/);
  expect(renderSvg(lay, tl, { lang: "ko" })).toMatch(/<desc>[^<]*a → b \(실패\)/);
});

describe("several paths in one file", () => {
  const src =
    "title T\na -> b : get\nnote look it up\nbranch hit\n  b --> a : value\nelse miss\n  b -x a : nil\n  a -> c : load\nend\na -> d : done";
  const all = async (source: string) => {
    const { doc } = parse(source);
    const paths = enumeratePaths(doc)!;
    const flow = doc.kind === "sequence" ? undefined : await layout(doc, buildTimeline(doc));
    const parts = svgParts(doc, paths, flow);
    return { parts, svg: renderSvgPaths(parts, { title: doc.title }) };
  };
  const balanced = (svg: string) =>
    (svg.match(/<[a-zA-Z]+(\s[^>]*)?(?<!\/)>/g) ?? []).length === (svg.match(/<\/[a-zA-Z]+>/g) ?? []).length;
  /** keyTimes must start at 0, end at 1 and never decrease, or the browser drops the animation */
  const validKeyTimes = (svg: string) =>
    [...svg.matchAll(/keyTimes="([^"]+)"/g)].every((m) => {
      const t = m[1].split(";").map(Number);
      return t[0] === 0 && t[t.length - 1] === 1 && t.every((v, i) => i === 0 || v >= t[i - 1]);
    });

  it("one path renders exactly as renderSvg", async () => {
    const { doc } = parse("a -> b : x\nb --> a");
    const tl = buildTimeline(doc);
    const l = await layout(doc, tl);
    expect(renderSvgPaths([{ layout: l, timeline: tl, caption: "ignored" }])).toBe(renderSvg(l, tl));
  });
  it("plays each path in turn in one loop", async () => {
    const { parts, svg } = await all(src);
    expect(parts).toHaveLength(2);
    const total = pathsSeconds(parts);
    expect(new Set([...svg.matchAll(/dur="([\d.]+)s"/g)].map((m) => Number(m[1])))).toEqual(new Set([total]));
    // 3 steps on the hit path, 4 on the miss path
    expect(svg.match(/<animateMotion/g)).toHaveLength(7);
    expect(svg).toContain("1/2 · hit");
    expect(svg).toContain("2/2 · miss");
    expect(svg).toMatch(/<desc>\[1\/2 hit\] 1\. a → b: get[^<]*\| \[2\/2 miss\] 1\. a → b: get/);
    expect(balanced(svg)).toBe(true);
    expect(validKeyTimes(svg)).toBe(true);
  });
  it("flow: edges are drawn once; steps restart their numbers on each path", async () => {
    const { svg } = await all(src);
    expect(svg.match(/class="edge"/g)).toHaveLength(5);
    expect(svg.match(/>1\. get</g)).toHaveLength(2);
    expect(svg).toContain(">3. done<");
    expect(svg).toContain(">4. done<");
  });
  it("sequence: each path has its own rows with unique ids, lifelines are drawn once", async () => {
    const { parts, svg } = await all(`diagram sequence\n${src}`);
    expect(parts[0].layout).not.toBe(parts[1].layout);
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("p0s0_0");
    expect(ids).toContain("p1s3_0");
    for (const m of svg.matchAll(/<mpath href="#([^"]+)"/g)) expect(ids).toContain(m[1]);
    expect(svg.match(/class="life"/g)).toHaveLength(4);
    const tall = Math.max(...parts.map((p) => p.layout.height));
    expect(svg).toContain(`height="${tall + 44 + 26 + 22 + 18}"`);
    expect(validKeyTimes(svg)).toBe(true);
  });
  it("renders long loops with notes on many paths (no argument-count limit)", async () => {
    const two = "branch yes\n  a -> b\nelse no\n  a -> b\nend\n";
    const { doc } = parse(`loop 9000\n  a -> b\n  note again\nend\n${two.repeat(4)}`);
    const parts = svgParts(doc, enumeratePaths(doc)!, { nodes: [], edges: [], groups: [], width: 300, height: 200 });
    expect(parts).toHaveLength(16);
    expect(() => renderSvgPaths(parts)).not.toThrow();
  });
  it("reduced motion shows the first path only", async () => {
    const { svg } = await all(src);
    expect(svg).toContain(".alt{display:none}");
    expect(svg.match(/<g class="alt">/g)).toHaveLength(1);
  });
});

describe("sequence activation bars", () => {
  const seqSvg = (src: string) => {
    const { doc } = parse(`diagram sequence\n${src}`);
    const tl = buildTimeline(doc);
    return renderSvg(layoutSequence(doc, tl), tl);
  };
  it("draws one bar per answered request, under the arrows, appearing when the request arrives", () => {
    const svg = seqSvg("speed 1\na -> b : q\nb --> a : r");
    expect(svg.match(/class="act"/g)).toHaveLength(1);
    expect(svg.indexOf('class="act"')).toBeLessThan(svg.indexOf('class="hl'));
    // total loop = 2s + 1.5s hold; the dot arrives at 0.85s
    const bar = svg.match(/<rect [^>]*class="act"[^>]*>(<animate [^>]*>)/)![1];
    expect(bar).toContain(`keyTimes="0;${(0.85 / 3.5).toFixed(4)};${(0.85 / 3.5).toFixed(4)};`);
    expect(svg).toContain(".hl,.lbl,.act{opacity:1 !important}");
  });
  it("flow diagrams and unanswered requests have none", async () => {
    expect(seqSvg("a -> b\nb -> c")).not.toContain('class="act"');
    expect(await make("a -> b\nb --> a")).not.toContain('class="act"');
  });
  it("several paths: each path has its own bars", () => {
    const { doc } = parse(
      "diagram sequence\na -> b\nbranch ok\n  b --> a\nelse slow\n  b -> c\n  c --> b\n  b --> a\nend",
    );
    const svg = renderSvgPaths(svgParts(doc, enumeratePaths(doc)!));
    expect(svg.match(/class="act"/g)).toHaveLength(3);
  });
});
