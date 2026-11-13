import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { compile } from "@mdx-js/mdx";
import MarkdownIt from "markdown-it";
import remarkEne, { type RemarkEneOptions } from "../src/index.js";
import markdownItEne from "../src/markdown-it.js";

const md = (body: string) => `# Doc\n\nIntro.\n\n${body}\n\nAfter.\n`;
const fence = (src: string, meta = "") => "```ene" + (meta ? " " + meta : "") + "\n" + src + "\n```";
const FLOW = "user -> api : GET /\napi --> user : 200";

async function toHtml(input: string, opts?: RemarkEneOptions) {
  const file = await unified()
    .use(remarkParse)
    .use(remarkEne, opts)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(input);
  return { html: String(file), messages: file.messages.map((m) => m.message) };
}

describe("remark-ene static", () => {
  it("renders an inline animated SVG", async () => {
    const { html } = await toHtml(md(fence(FLOW)));
    expect(html).toContain('<div class="ene-diagram"><svg');
    expect(html).toContain("<animate");
    expect(html).toContain("<p>After.</p>");
    expect(html).not.toContain("<code");
  });
  it("leaves other code blocks alone", async () => {
    const { html } = await toHtml(md("```js\nlet a = 1\n```"));
    expect(html).toContain('<code class="language-js">');
  });
  it("uses the meta title and escapes it", async () => {
    const { html } = await toHtml(md(fence(FLOW, 'title="<b>Hi</b> & co"')));
    expect(html).toContain("&lt;b>Hi&lt;/b> &amp; co".replace("&lt;b>", "&lt;b&gt;").replace("&lt;/b>", "&lt;/b&gt;"));
    expect(html).not.toContain("<b>Hi</b>");
  });
  it("escapes labels from diagram source", async () => {
    const { html } = await toHtml(md(fence("user -> api : <img src=x onerror=alert(1)>")));
    expect(html).not.toContain("<img");
  });
  it("scopes ids so two diagrams on a page do not collide", async () => {
    const { html } = await toHtml(md(fence(FLOW) + "\n\n" + fence(FLOW)));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of html.matchAll(/href="#([^"]+)"/g)) expect(ids).toContain(m[1]);
  });
  it("scopes the stylesheet to its own SVG", async () => {
    const { html } = await toHtml(md(fence(FLOW)));
    const css = html.match(/<style>([\s\S]*?)<\/style>/)![1];
    for (const m of css.matchAll(/([^{}]+)\{/g)) {
      if (m[1].trim().startsWith("@")) continue;
      for (const sel of m[1].split(",")) expect(sel.trim()).toMatch(/^(svg)?\.ene-[\w-]+root\b/);
    }
    expect(html).toMatch(/<svg [^>]*class="[^"]*\bene-[\w-]+root"/);
  });
  it("does not rewrite reference-like text in labels", async () => {
    const { html } = await toHtml(md(fence('user -> api : url(#x) href="#y" id=z')));
    expect(html).toContain("url(#x) href=&quot;#y&quot; id=z");
  });
  it("applies choice from meta", async () => {
    const src = "a -> b : go\nbranch ok\n  b --> a : fine\nelse fail\n  b -x a : broken\nend";
    const a = await toHtml(md(fence(src, "choice=0")));
    const b = await toHtml(md(fence(src, "choice=1")));
    expect(a.html).not.toBe(b.html);
    expect(b.html).toContain("broken");
    expect(a.html).not.toContain("broken");
  });
  it("shows an error box and reports a message", async () => {
    const { html, messages } = await toHtml(md(fence("user -> : <script>x</script>")));
    expect(html).toContain('class="ene-error"');
    expect(html).not.toContain("<script>");
    expect(messages.join("\n")).toMatch(/errors/);
  });
  it("fails the build with failOnError", async () => {
    await expect(toHtml(md(fence("user -> ")), { failOnError: true })).rejects.toThrow(/ene diagram has errors/);
  });
  it("does not fetch icons unless network is allowed", async () => {
    const { html, messages } = await toHtml(md(fence("u[User]{icon: https://example.invalid/i.svg} -> api : go")));
    expect(html).toContain("<svg");
    expect(messages.join("\n")).toMatch(/network access is disabled/);
  });
  it("does not read local icon files", async () => {
    const { messages } = await toHtml(md(fence("u[User]{icon: ../../etc/x.svg} -> api : go")));
    expect(messages.join("\n")).toMatch(/only https/);
  });
});

describe("remark-ene live", () => {
  it("emits pre.ene with escaped source and one script", async () => {
    const { html } = await toHtml(md(fence("a -> b : <x>") + "\n\n" + fence(FLOW)), { mode: "live" });
    expect(html).toContain('<pre class="ene">a -> b : &lt;x&gt;</pre>'.replace("->", "-&gt;"));
    expect(html.match(/<script /g)?.length).toBe(1);
    expect(html).toContain("@ene-diagram/player@0.1/dist/ene.js");
  });
  it("supports a per-fence override and script: false", async () => {
    const { html } = await toHtml(md(fence(FLOW, "live title=Hello")), { script: false });
    expect(html).toContain('<pre class="ene">title Hello\n');
    expect(html).not.toContain("<script");
  });
});

describe("remark-ene with MDX", () => {
  it("compiles to JSX with the SVG as innerHTML", async () => {
    const out = String(await compile(md(fence(FLOW)), { remarkPlugins: [remarkEne] }));
    expect(out).toContain("dangerouslySetInnerHTML");
    expect(out).toContain("<animate");
  });
  it("live mode in MDX does not add a script", async () => {
    const out = String(await compile(md(fence(FLOW)), { remarkPlugins: [[remarkEne, { mode: "live" }]] }));
    expect(out).toContain('class=\\"ene\\"');
    expect(out).not.toContain("<script");
  });
});

describe("markdown-it plugin", () => {
  it("renders pre.ene and keeps other fences", () => {
    const mdi = new MarkdownIt().use(markdownItEne);
    const html = mdi.render(md(fence("a -> b : {{ x }} <y>", 'title="T"')) + "\n```js\n1\n```\n");
    expect(html).toContain('<div class="ene-diagram" v-pre><pre class="ene">title T\na -&gt; b : {{ x }} &lt;y&gt;');
    expect(html).toContain('<code class="language-js">');
    expect(html.match(/<script /g)?.length).toBe(1);
  });
  it("script: false", () => {
    const html = new MarkdownIt().use(markdownItEne, { script: false }).render(fence(FLOW));
    expect(html).not.toContain("<script");
  });
});

describe("themes and notes from main", () => {
  it("keeps each inline diagram's theme to itself and shows step notes", async () => {
    const { html } = await toHtml(
      md(fence("theme mono\na -> b\nnote why") + "\n\n" + fence("theme high-contrast\na ~> b")),
    );
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    expect(styles).toHaveLength(2);
    // no rule may target every <svg> on the page
    for (const s of styles) expect(s).not.toMatch(/(^|[}\s;])svg\{/);
    const bgRules = styles.map((s) => s.match(/[^{}]*\{--bg:[^;]*/g) ?? []);
    expect(bgRules[0].join(" ")).toContain("#ffffff");
    expect(bgRules[0].join(" ")).not.toContain("#000000");
    expect(bgRules[1].join(" ")).toContain("#000000");
    expect(html).toContain('class="note"');
  });
  it("puts the scope into the one class attribute of the root svg, next to the theme class", async () => {
    const { html } = await toHtml(md(fence("theme mono\na -> b")));
    const root = html.match(/<svg[^>]*>/)![0];
    expect(root.match(/ class=/g)).toHaveLength(1);
    const cls = root.match(/ class="([^"]*)"/)![1].split(" ");
    expect(cls).toContain("ene-theme-mono");
    const scoped = html.match(/svg\.([\w-]+-root)\.ene-theme-mono\{--bg:/);
    expect(scoped).toBeTruthy();
    expect(cls).toContain(scoped![1]);
  });
});
