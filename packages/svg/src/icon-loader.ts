import type { ResolvedIcon } from "@ene/core";
import { iconFromSvgText } from "./index.js";

export interface IconFetchOptions {
  /** Abort the request after this many milliseconds (default 5000) */
  timeoutMs?: number;
  /** Reject responses larger than this many bytes, checked while streaming (default 512 KiB) */
  maxBytes?: number;
  /** If set, only http(s) URLs whose host is in this list are fetched */
  allowHosts?: string[];
  /** fetch implementation (default: globalThis.fetch) */
  fetch?: typeof fetch;
}
export type IconLoadResult = { ok: true; icon: ResolvedIcon } | { ok: false; reason: string };

export const ICON_DEFAULTS = { timeoutMs: 5000, maxBytes: 512 * 1024 };

/** Basic sanity check: must look like a standalone SVG document */
export function iconFromUntrustedSvg(text: string): IconLoadResult {
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) return { ok: false, reason: "response is not an SVG document" };
  const icon = iconFromSvgText(text);
  if (!(icon.width > 0 && icon.height > 0 && icon.width <= 4096 && icon.height <= 4096)) return { ok: false, reason: "invalid viewBox size" };
  return { ok: true, icon };
}

/** Fetch an SVG icon with a timeout, a streamed size limit and an optional host allowlist */
export async function fetchIcon(url: string, opts: IconFetchOptions = {}): Promise<IconLoadResult> {
  const timeoutMs = opts.timeoutMs ?? ICON_DEFAULTS.timeoutMs, maxBytes = opts.maxBytes ?? ICON_DEFAULTS.maxBytes;
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, reason: "invalid URL" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: `unsupported scheme ${u.protocol}` };
  if (opts.allowHosts && !opts.allowHosts.includes(u.host) && !opts.allowHosts.includes(u.hostname)) return { ok: false, reason: `host ${u.host} is not allowed` };
  const f = opts.fetch ?? globalThis.fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await f(url, { signal: ctl.signal, redirect: opts.allowHosts ? "error" : "follow" });
    if (!r.ok) { ctl.abort(); return { ok: false, reason: `HTTP ${r.status}` }; }
    const len = Number(r.headers.get("content-length"));
    if (len > maxBytes) { ctl.abort(); return { ok: false, reason: `response too large (${len} > ${maxBytes} bytes)` }; }
    let text: string;
    if (r.body && typeof r.body.getReader === "function") {
      const reader = r.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { ctl.abort(); await reader.cancel().catch(() => {}); return { ok: false, reason: `response too large (> ${maxBytes} bytes)` }; }
        chunks.push(value);
      }
      const all = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.byteLength; }
      text = new TextDecoder().decode(all);
    } else {
      text = await r.text();
      if (text.length > maxBytes) return { ok: false, reason: `response too large (> ${maxBytes} bytes)` };
    }
    return iconFromUntrustedSvg(text);
  } catch (e) {
    if (ctl.signal.aborted) return { ok: false, reason: `timed out after ${timeoutMs} ms` };
    return { ok: false, reason: (e as Error).message || "network error" };
  } finally { clearTimeout(timer); }
}
