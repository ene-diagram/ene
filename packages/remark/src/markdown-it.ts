import { DEFAULT_PLAYER_URL, escapeHtml, liveSource, parseMeta } from "./render.js";

export interface MarkdownItEneOptions {
  /** Player script URL added before the first diagram of each render (default: jsDelivr). `false` to load it yourself */
  script?: string | false;
}

// Minimal markdown-it shapes, so the package does not depend on markdown-it
interface Token { info: string; content: string }
interface MarkdownItLike {
  renderer: { rules: Record<string, ((tokens: Token[], idx: number, options: unknown, env: Record<string, unknown>, self: unknown) => string) | undefined> };
}

/**
 * markdown-it plugin (VitePress, markdown-it based sites): ```ene fences become `<pre class="ene">` for
 * the browser player. markdown-it renders synchronously, so build-time SVG is not available here;
 * use `renderEne` from `@ene-diagram/remark` in a build step for that.
 */
export default function markdownItEne(md: MarkdownItLike, options: MarkdownItEneOptions = {}) {
  const fallback = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const t = tokens[idx];
    const [lang, ...rest] = t.info.trim().split(/\s+/);
    if (lang !== "ene") return fallback ? fallback(tokens, idx, opts, env, self) : `<pre><code>${escapeHtml(t.content)}</code></pre>`;
    const meta = parseMeta(rest.join(" "));
    let html = `<div class="ene-diagram" v-pre><pre class="ene">${escapeHtml(liveSource(t.content, meta.title))}</pre></div>`;
    const script = options.script ?? DEFAULT_PLAYER_URL;
    if (script && !env?.eneScriptAdded) {
      if (env) env.eneScriptAdded = true;
      html += `<script src="${escapeHtml(script)}" defer></script>`;
    }
    return html;
  };
}

export { markdownItEne };
