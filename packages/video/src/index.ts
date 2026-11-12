import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

export type VideoFormat = "gif" | "mp4";
export interface VideoOptions {
  /** Output file; the format comes from `format`, not the extension */
  out: string;
  format: VideoFormat;
  /** Length of one loop of the animation, in seconds */
  seconds: number;
  /** Frames per second (default: 20 for gif, 30 for mp4) */
  fps?: number;
  /** Pixel density of the frames (default: 1 for gif, 2 for mp4) */
  scale?: number;
  /** Called after each captured frame */
  onFrame?: (done: number, total: number) => void;
}
export interface VideoResult { frames: number; fps: number; width: number; height: number }

/** Thrown for problems the user can fix (missing Chrome/ffmpeg, bad options); `message` is ready to print */
export class VideoError extends Error {}

export const LIMITS = { frames: 3600, fps: 60, scale: 4 };
export const DEFAULTS: Record<VideoFormat, { fps: number; scale: number }> = { gif: { fps: 20, scale: 1 }, mp4: { fps: 30, scale: 2 } };

export const formatOf = (file: string): VideoFormat | undefined => {
  const m = file.toLowerCase().match(/\.(gif|mp4)$/);
  return m ? (m[1] as VideoFormat) : undefined;
};

/** Pixel size of an exported ene SVG, from the root element's width/height */
export function svgSize(svg: string): { width: number; height: number } {
  const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? "";
  const width = Number(root.match(/\swidth="([\d.]+)"/)?.[1]), height = Number(root.match(/\sheight="([\d.]+)"/)?.[1]);
  if (!(width > 0) || !(height > 0)) throw new VideoError("cannot read the size of the SVG (no width/height on the root element)");
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

/** Time of each frame: frame i shows the animation at i / fps, and the loop is not sampled at its very end (it equals frame 0) */
export function frameTimes(seconds: number, fps: number): number[] {
  const n = Math.max(1, Math.round(seconds * fps));
  return Array.from({ length: n }, (_, i) => i / fps);
}

export function ffmpegArgs(format: VideoFormat, fps: number, out: string): string[] {
  const input = ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-"];
  if (format === "gif")
    return [...input, "-filter_complex", "[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle", "-loop", "0", "-f", "gif", out];
  // yuv420p needs even dimensions; +faststart lets the file start playing before it is fully downloaded
  return [...input, "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2:color=white", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4", out];
}

const onPath = (name: string, env: NodeJS.ProcessEnv): string | undefined => {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean))
    for (const ext of exts) { const f = join(dir, name + ext); if (existsSync(f)) return f; }
};

/** A Chromium-based browser: `ENE_CHROME`, then the usual install locations */
export function findChrome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.ENE_CHROME) return existsSync(env.ENE_CHROME) ? env.ENE_CHROME : undefined;
  const mac = ["Google Chrome", "Chromium", "Microsoft Edge", "Brave Browser"].map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`);
  const win = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean).flatMap((d) =>
    [join(d!, "Google", "Chrome", "Application", "chrome.exe"), join(d!, "Microsoft", "Edge", "Application", "msedge.exe")]);
  const fixed = process.platform === "darwin" ? mac : process.platform === "win32" ? win : [];
  return fixed.find((f) => existsSync(f)) ??
    ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "chrome"].map((n) => onPath(n, env)).find(Boolean);
}

export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.ENE_FFMPEG) return existsSync(env.ENE_FFMPEG) ? env.ENE_FFMPEG : undefined;
  return onPath("ffmpeg", env);
}

/** Minimal Chrome DevTools Protocol client over the page's WebSocket */
class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private waiters = new Map<string, (() => void)[]>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p?.reject(new Error(`${msg.error.message}`)); else p?.resolve(msg.result);
      } else if (msg.method) this.waiters.get(msg.method)?.splice(0).forEach((f) => f());
    });
    ws.addEventListener("close", () => { for (const p of this.pending.values()) p.reject(new Error("the browser closed the connection")); this.pending.clear(); });
  }
  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Cdp(ws)));
      ws.addEventListener("error", () => reject(new Error("cannot connect to the browser")));
    });
  }
  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  once(event: string): Promise<void> {
    return new Promise((resolve) => this.waiters.set(event, [...(this.waiters.get(event) ?? []), resolve]));
  }
  close() { this.ws.close(); }
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new VideoError(`timed out while ${what}`)), ms); })]).finally(() => clearTimeout(timer));
};

/** Start headless Chrome and resolve with the DevTools HTTP endpoint it prints on stderr */
function launchChrome(bin: string, profile: string): { proc: ChildProcess; endpoint: Promise<string> } {
  const args = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--force-color-profile=srgb", "about:blank"];
  // Chrome refuses to run its sandbox as root (containers, CI)
  if (process.getuid?.() === 0 || process.env.ENE_CHROME_NO_SANDBOX) args.unshift("--no-sandbox");
  const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = new Promise<string>((resolve, reject) => {
    let err = "";
    proc.stderr!.on("data", (d: Buffer) => {
      err += d.toString();
      const m = err.match(/DevTools listening on ws:\/\/([^/\s]+)\//);
      if (m) resolve(`http://${m[1]}`);
    });
    proc.on("error", (e) => reject(new VideoError(`cannot start the browser at ${bin} (${(e as NodeJS.ErrnoException).code ?? e.message})`)));
    proc.on("exit", (code) => reject(new VideoError(`the browser exited before it was ready (code ${code})${err ? `:\n${err.trim().split("\n").slice(-3).join("\n")}` : ""}`)));
  });
  return { proc, endpoint };
}

/**
 * Render one loop of an exported ene SVG to a GIF or MP4.
 * Frames are captured in headless Chrome by seeking the SVG's own animation clock, so the result is
 * exactly what the SVG plays, independent of how fast the machine is. ffmpeg encodes the frames.
 */
export async function renderVideo(svg: string, opts: VideoOptions): Promise<VideoResult> {
  const d = DEFAULTS[opts.format];
  const fps = opts.fps ?? d.fps, scale = opts.scale ?? d.scale;
  if (!(fps >= 1 && fps <= LIMITS.fps)) throw new VideoError(`fps must be between 1 and ${LIMITS.fps}`);
  if (!(scale >= 0.5 && scale <= LIMITS.scale)) throw new VideoError(`scale must be between 0.5 and ${LIMITS.scale}`);
  if (!(opts.seconds > 0) || !Number.isFinite(opts.seconds)) throw new VideoError("the animation has no length");
  // Checked before the frame list is built: an absurd length must be an error, not an allocation
  const count = Math.max(1, Math.round(opts.seconds * fps));
  if (count > LIMITS.frames)
    throw new VideoError(`the animation needs ${count} frames (${opts.seconds.toFixed(1)}s at ${fps} fps); the limit is ${LIMITS.frames}. Lower --fps or shorten the diagram`);
  const times = frameTimes(opts.seconds, fps);
  const { width, height } = svgSize(svg);
  if (typeof WebSocket === "undefined") throw new VideoError("GIF/MP4 export needs Node.js 22 or newer");
  const chrome = findChrome();
  if (!chrome) throw new VideoError("GIF/MP4 export needs Chrome, Chromium or Edge. Install one, or set ENE_CHROME to its executable");
  const ffmpegBin = findFfmpeg();
  if (!ffmpegBin) throw new VideoError("GIF/MP4 export needs ffmpeg on PATH (or set ENE_FFMPEG). Install it, e.g. `brew install ffmpeg`");

  const work = mkdtempSync(join(tmpdir(), "ene-video-"));
  const page = join(work, "frame.svg");
  writeFileSync(page, svg);
  const { proc: browser, endpoint } = launchChrome(chrome, join(work, "profile"));
  // Encode next to the frames and copy to the destination only after success, so a failed export
  // never truncates or removes a file that was already there
  const encodedFile = join(work, `out.${opts.format}`);
  const ffmpeg = spawn(ffmpegBin, ffmpegArgs(opts.format, fps, encodedFile), { stdio: ["pipe", "ignore", "pipe"] });
  let ffErr = "";
  ffmpeg.stderr!.on("data", (b: Buffer) => { ffErr += b.toString(); });
  const encoded = new Promise<void>((resolve, reject) => {
    ffmpeg.on("error", (e) => reject(new VideoError(`cannot start ffmpeg (${(e as NodeJS.ErrnoException).code ?? e.message})`)));
    ffmpeg.on("exit", (code) => (code === 0 ? resolve() : reject(new VideoError(`ffmpeg failed (code ${code})${ffErr ? `:\n${ffErr.trim()}` : ""}`))));
  });
  // A broken pipe is reported through ffmpeg's exit code, not as an unhandled stream error
  ffmpeg.stdin!.on("error", () => {});
  encoded.catch(() => {});
  let cdp: Cdp | undefined;
  try {
    const http = await withTimeout(endpoint, 30_000, "starting the browser");
    const targets = (await (await fetch(`${http}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    const target = targets.find((t) => t.type === "page");
    if (!target) throw new VideoError("the browser has no page to draw on");
    cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "no-preference" }] });
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: pathToFileURL(page).href });
    await withTimeout(loaded, 30_000, "loading the SVG");
    await cdp.send("Runtime.evaluate", { expression: "document.documentElement.pauseAnimations()" });
    for (const [i, t] of times.entries()) {
      // Seek the SMIL clock, then wait for the next frame so the seeked state is what gets captured
      const seek = await cdp.send("Runtime.evaluate", {
        awaitPromise: true,
        expression: `new Promise((r) => { document.documentElement.setCurrentTime(${t}); requestAnimationFrame(() => r(true)); })`,
      });
      if (seek.exceptionDetails) throw new VideoError(`cannot seek the animation: ${seek.exceptionDetails.text}`);
      const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
      const png = Buffer.from(shot.data, "base64");
      if (!ffmpeg.stdin!.write(png)) await Promise.race([new Promise((r) => ffmpeg.stdin!.once("drain", r)), encoded]);
      opts.onFrame?.(i + 1, times.length);
    }
    ffmpeg.stdin!.end();
    await encoded;
    try { copyFileSync(encodedFile, opts.out); }
    catch (e) { throw new VideoError(`cannot write ${opts.out} (${(e as NodeJS.ErrnoException).code ?? "unknown"})`); }
    return { frames: times.length, fps, width: Math.round(width * scale), height: Math.round(height * scale) };
  } catch (e) {
    ffmpeg.kill();
    throw e;
  } finally {
    cdp?.close();
    browser.removeAllListeners("exit");
    browser.kill();
    // Chrome may still be flushing its profile directory when it is killed
    await new Promise<void>((r) => (browser.exitCode !== null || browser.signalCode ? r() : browser.once("exit", () => r())));
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/** For tests and `--help`: what the export would use on this machine */
export const environment = () => ({ chrome: findChrome(), ffmpeg: findFfmpeg(), websocket: typeof WebSocket !== "undefined" });
export const hasLibx264 = (ffmpeg: string) => /\blibx264\b/.test(spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "");
