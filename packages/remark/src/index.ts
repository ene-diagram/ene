import {
  DEFAULT_PLAYER_URL,
  errorHtml,
  escapeHtml,
  hash,
  scopeSvg,
  liveSource,
  parseMeta,
  renderEne,
  type RenderOptions,
} from "./render.js";

export {
  renderEne,
  parseMeta,
  scopeSvg,
  liveSource,
  errorHtml,
  DEFAULT_PLAYER_URL,
  type RenderOptions,
  type RenderResult,
} from "./render.js";

export interface RemarkEneOptions extends RenderOptions {
  /**
   * "static" (default): render an animated SVG at build time, no client JS.
   * "live": emit `<pre class="ene">` for the browser player (pick a branch, step, pause).
   * A fence can override this with `live` or `static` in its meta.
   */
  mode?: "static" | "live";
  /**
   * Live mode: player script URL added once per document (default: jsDelivr, @ene-diagram/player@0.1).
   * `false` to load the player yourself. Never added in MDX output, where you load it from the layout.
   */
  script?: string | false;
  /** Fail the build (file.fail) when a diagram has errors, instead of showing an error box */
  failOnError?: boolean;
  /**
   * Emit MDX JSX nodes instead of raw `html` nodes. Default: auto (`.mdx` files, or a tree that
   * already holds MDX nodes). Set `true` for Docusaurus, where `.md` files are MDX too.
   */
  mdx?: boolean;
  /** Extra class on the wrapping `<div>` (default "ene-diagram") */
  className?: string;
}

// Minimal mdast/vfile shapes so the plugin has no type dependencies
interface Node {
  type: string;
  lang?: string | null;
  meta?: string | null;
  value?: string;
  children?: Node[];
  [k: string]: unknown;
}
interface VFileLike {
  path?: string;
  extname?: string;
  message(reason: string, place?: unknown): unknown;
  fail(reason: string, place?: unknown): never;
}

/** Raw HTML as an `html` node, or for MDX as `<div dangerouslySetInnerHTML={{__html: "..."}} />` */
function htmlNode(html: string, mdx: boolean, className: string): Node {
  if (!mdx) return { type: "html", value: `<div class="${escapeHtml(className)}">${html}</div>` };
  const lit = { type: "Literal", value: html, raw: JSON.stringify(html) };
  const obj = {
    type: "ObjectExpression",
    properties: [
      {
        type: "Property",
        method: false,
        shorthand: false,
        computed: false,
        kind: "init",
        key: { type: "Identifier", name: "__html" },
        value: lit,
      },
    ],
  };
  return {
    type: "mdxJsxFlowElement",
    name: "div",
    children: [],
    attributes: [
      { type: "mdxJsxAttribute", name: "className", value: className },
      {
        type: "mdxJsxAttribute",
        name: "dangerouslySetInnerHTML",
        value: {
          type: "mdxJsxAttributeValueExpression",
          value: `{__html: ${JSON.stringify(html)}}`,
          data: {
            estree: { type: "Program", sourceType: "module", body: [{ type: "ExpressionStatement", expression: obj }] },
          },
        },
      },
    ],
  };
}

/** True when the processor parses MDX (remark-mdx registers mdxJsx from-markdown handlers) */
function usesMdx(processor: unknown): boolean {
  const data = (processor as { data?: (key: string) => unknown } | undefined)?.data;
  if (typeof data !== "function") return false;
  const exts = data.call(processor, "fromMarkdownExtensions");
  const flat = (x: unknown): unknown[] => (Array.isArray(x) ? x.flatMap(flat) : [x]);
  return flat(exts).some(
    (e) =>
      !!e && typeof e === "object" && "enter" in e && !!(e as { enter?: Record<string, unknown> }).enter?.mdxJsxFlowTag,
  );
}

function walk(node: Node, fn: (n: Node, parent: Node, i: number) => void) {
  node.children?.forEach((c, i) => {
    fn(c, node, i);
    walk(c, fn);
  });
}

/** remark plugin: ```ene fences → animated SVG (static) or player markup (live) */
export default function remarkEne(this: unknown, options: RemarkEneOptions = {}) {
  const mdxParser = usesMdx(this);
  const className = options.className ?? "ene-diagram";
  return async (tree: Node, file: VFileLike) => {
    const found: { node: Node; parent: Node; i: number }[] = [];
    let hasMdxNodes = false;
    walk(tree, (n, parent, i) => {
      if (n.type.startsWith("mdx")) hasMdxNodes = true;
      if (n.type === "code" && n.lang === "ene") found.push({ node: n, parent, i });
    });
    if (!found.length) return;
    const mdx = options.mdx ?? (mdxParser || hasMdxNodes || file.extname === ".mdx" || /\.mdx$/i.test(file.path ?? ""));
    let scriptAdded = false;
    await Promise.all(
      found.map(async ({ node, parent, i }, k) => {
        const meta = parseMeta(node.meta);
        const src = node.value ?? "";
        let mode = meta.mode ?? options.mode ?? "static";
        // The player in the page cannot read files, so a diagram that includes one is drawn at build time
        if (mode === "live" && /^[ \t]*include[ \t]/m.test(src)) {
          file.message("ene: a diagram with `include` cannot be live; rendered as a static SVG", node.position);
          mode = "static";
        }
        let html: string;
        if (mode === "live") {
          html = `<pre class="ene">${escapeHtml(liveSource(src, meta.title))}</pre>`;
          const script = options.script ?? DEFAULT_PLAYER_URL;
          if (!mdx && script && !scriptAdded) {
            scriptAdded = true;
            html += `<script src="${escapeHtml(script)}" defer></script>`;
          }
        } else {
          const r = await renderEne(src, {
            ...options,
            title: meta.title ?? options.title,
            choice: meta.choice ?? options.choice,
          });
          for (const w of r.warnings) file.message(`ene: ${w}`, node.position);
          if (r.ok) html = scopeSvg(r.svg, `ene-${hash(src)}-${k}-`);
          else if (options.failOnError) return file.fail(`ene diagram has errors:\n${r.error}`, node.position);
          else {
            file.message(`ene diagram has errors:\n${r.error}`, node.position);
            html = errorHtml(r.error);
          }
        }
        parent.children![i] = htmlNode(html, mdx, className);
      }),
    );
  };
}

export { remarkEne };
