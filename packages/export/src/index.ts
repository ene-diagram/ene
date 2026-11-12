import { applyTheme, freeze, frameTimes, loopLength, stripReducedMotion, svgSize, type Theme } from "./frames.js";
import { GIF_MAX_FPS, GifEncoder, buildPalette } from "./gif.js";
import { muxMp4, type Mp4Sample } from "./mp4.js";

export { applyTheme, freeze, frameTimes, loopLength, sample, stripReducedMotion, svgSize, type PointAt, type Theme } from "./frames.js";
export { GIF_MAX_FPS, GifEncoder, buildPalette, encodeGif, lzw, type GifFrame } from "./gif.js";
export { muxMp4, type Mp4Options, type Mp4Sample } from "./mp4.js";

export type ExportFormat = "gif" | "mp4" | "webm";
export interface ExportOptions {
  format: ExportFormat;
  /** Frames per second (default: 15 for gif, 30 for video) */
  fps?: number;
  /** Pixel density (default: 1 for gif, 2 for video) */
  scale?: number;
  /** Colour scheme of the frames (default: light) */
  theme?: Theme;
  /** Called after each frame is drawn */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}
export interface ExportResult { blob: Blob; format: ExportFormat; frames: number; width: number; height: number }

export const LIMITS = { frames: 1800, fps: 60, scale: 4, pixels: 4096 * 4096 };
export const DEFAULTS: Record<ExportFormat, { fps: number; scale: number }> = { gif: { fps: 15, scale: 1 }, mp4: { fps: 30, scale: 2 }, webm: { fps: 30, scale: 2 } };

/** Theme a downloadable animated SVG: `auto` keeps following the viewer's dark mode */
export const themedSvg = (svg: string, theme: Theme = "auto") => applyTheme(svg, theme);

const WEBM = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
const H264 = ["avc1.640034", "avc1.640028", "avc1.4d0028", "avc1.42002a", "avc1.42001f"];

/** Which video format this browser can encode without a real-time recording: mp4 (WebCodecs H.264), else webm (MediaRecorder) */
export async function videoSupport(): Promise<{ mp4: boolean; webm: boolean }> {
  const mp4 = typeof VideoEncoder !== "undefined" &&
    (await Promise.all(H264.map((codec) => VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720 }).then((r) => !!r.supported, () => false)))).some(Boolean);
  const webm = typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype &&
    WEBM.some((t) => MediaRecorder.isTypeSupported(t));
  return { mp4, webm };
}

const aborted = (signal?: AbortSignal) => { if (signal?.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError"); };

/** Draws frames of one SVG onto a canvas */
class Framer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private host: HTMLDivElement;
  private root: SVGSVGElement;
  private paths = new Map<string, SVGPathElement>();
  readonly width: number; readonly height: number;
  constructor(svg: string, private scale: number, even: boolean) {
    const size = svgSize(svg);
    const w = Math.round(size.width * scale), h = Math.round(size.height * scale);
    this.width = even ? w + (w % 2) : w; this.height = even ? h + (h % 2) : h;
    if (this.width * this.height > LIMITS.pixels) throw new Error(`the frames would be ${this.width}×${this.height} pixels; lower the scale`);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width; this.canvas.height = this.height;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    // Mounted (but invisible) so path geometry is available; the animations are paused
    this.host = document.createElement("div");
    this.host.setAttribute("aria-hidden", "true");
    this.host.style.cssText = "position:fixed;left:-100000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none";
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("the SVG could not be parsed");
    this.root = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
    this.host.appendChild(this.root);
    document.body.appendChild(this.host);
    this.root.pauseAnimations?.();
    for (const p of Array.from(this.root.querySelectorAll<SVGPathElement>("path[id]"))) this.paths.set(p.id, p);
  }
  private pointAt = (id: string, f: number) => {
    const p = this.paths.get(id);
    if (!p) return undefined;
    const pt = p.getPointAtLength(p.getTotalLength() * f);
    return { x: pt.x, y: pt.y };
  };
  async draw(t: number): Promise<void> {
    const copy = this.root.cloneNode(true) as SVGSVGElement;
    freeze(copy, t, this.pointAt);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      this.ctx.fillStyle = "#fff";
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.ctx.drawImage(img, 0, 0, Math.round(img.width * this.scale), Math.round(img.height * this.scale));
    } finally { URL.revokeObjectURL(url); }
  }
  pixels(): ImageData { return this.ctx.getImageData(0, 0, this.width, this.height); }
  dispose() { this.host.remove(); }
}

/**
 * Encode one loop of an exported ene SVG as a GIF, MP4 (WebCodecs H.264) or WebM (MediaRecorder,
 * recorded in real time). Runs in the browser; nothing is uploaded.
 */
export async function exportVideo(svg: string, opts: ExportOptions): Promise<ExportResult> {
  const d = DEFAULTS[opts.format];
  if (!d) throw new Error(`unknown format ${opts.format}`);
  const fps = opts.fps ?? d.fps, scale = opts.scale ?? d.scale;
  const maxFps = opts.format === "gif" ? GIF_MAX_FPS : LIMITS.fps;
  if (!(fps >= 1 && fps <= maxFps)) throw new Error(`fps must be between 1 and ${maxFps}${opts.format === "gif" ? " for a GIF" : ""}`);
  if (!(scale >= 0.5 && scale <= LIMITS.scale)) throw new Error(`scale must be between 0.5 and ${LIMITS.scale}`);
  const seconds = loopLength(svg);
  if (!(seconds > 0)) throw new Error("the SVG has no animation");
  const count = Math.round(seconds * fps);
  if (count > LIMITS.frames) throw new Error(`the animation needs ${count} frames; the limit is ${LIMITS.frames}. Lower the fps`);
  const times = frameTimes(seconds, fps);
  const source = stripReducedMotion(applyTheme(svg, opts.theme ?? "light"));
  const framer = new Framer(source, scale, opts.format !== "gif");
  const { width, height } = framer;
  try {
    if (opts.format === "gif") {
      // Pass 1: a palette from a few sampled frames. Pass 2: encode each frame as it is drawn,
      // so memory stays at a couple of frames whatever the length
      const picks = [...new Set(Array.from({ length: Math.min(12, times.length) }, (_, k) => Math.floor((k * times.length) / Math.min(12, times.length))))];
      const samples = [];
      for (const k of picks) { aborted(opts.signal); await framer.draw(times[k]); samples.push(framer.pixels()); }
      const enc = new GifEncoder(width, height, buildPalette(samples), fps);
      samples.length = 0;
      for (const [i, t] of times.entries()) {
        aborted(opts.signal);
        await framer.draw(t);
        enc.add(framer.pixels());
        opts.onProgress?.(i + 1, times.length);
      }
      return { blob: new Blob([enc.finish() as BlobPart], { type: "image/gif" }), format: "gif", frames: times.length, width, height };
    }
    if (opts.format === "mp4") {
      const blob = await encodeMp4(framer, times, fps, opts);
      return { blob, format: "mp4", frames: times.length, width, height };
    }
    const blob = await recordWebm(framer, times, fps, opts);
    return { blob, format: "webm", frames: times.length, width, height };
  } finally { framer.dispose(); }
}

async function encodeMp4(framer: Framer, times: number[], fps: number, opts: ExportOptions): Promise<Blob> {
  if (typeof VideoEncoder === "undefined") throw new Error("this browser cannot encode MP4 (no WebCodecs); use WebM");
  const { width, height } = framer;
  let config: VideoEncoderConfig | undefined;
  for (const codec of H264) {
    const c: VideoEncoderConfig = { codec, width, height, framerate: fps, bitrate: Math.min(20e6, Math.max(1e6, width * height * fps * 0.15)), avc: { format: "avc" } };
    if ((await VideoEncoder.isConfigSupported(c).catch(() => ({ supported: false }))).supported) { config = c; break; }
  }
  if (!config) throw new Error(`this browser cannot encode H.264 at ${width}×${height}; lower the scale or use WebM`);
  const samples: Mp4Sample[] = [];
  let avcC: Uint8Array | undefined, failure: Error | undefined;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      const desc = meta?.decoderConfig?.description;
      if (desc && !avcC) avcC = new Uint8Array(ArrayBuffer.isView(desc) ? desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength) : desc);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === "key" });
    },
    error: (e) => { failure = e as Error; },
  });
  try {
    enc.configure(config);
    const us = 1e6 / fps;
    for (const [i, t] of times.entries()) {
      aborted(opts.signal);
      if (failure) throw failure;
      await framer.draw(t);
      const frame = new VideoFrame(framer.canvas, { timestamp: Math.round(i * us), duration: Math.round(us) });
      enc.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 });
      frame.close();
      // Keep the encoder queue short so memory stays bounded
      while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      opts.onProgress?.(i + 1, times.length);
    }
    await enc.flush();
    if (failure) throw failure;
  } finally { if (enc.state !== "closed") enc.close(); }
  if (!avcC) throw new Error("the encoder did not report its configuration");
  return new Blob([muxMp4({ width, height, fps, avcC }, samples) as BlobPart], { type: "video/mp4" });
}

async function recordWebm(framer: Framer, times: number[], fps: number, opts: ExportOptions): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") throw new Error("this browser cannot record video");
  const type = WEBM.find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error("this browser cannot record WebM");
  await framer.draw(0);
  const stream = framer.canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const done = new Promise<void>((resolve, reject) => { rec.onstop = () => resolve(); rec.onerror = () => reject(new Error("recording failed")); });
  rec.start();
  // MediaRecorder timestamps frames by wall clock, so frames are pushed at the real frame rate
  const start = performance.now();
  try {
    for (const [i, t] of times.entries()) {
      aborted(opts.signal);
      if (i > 0) await framer.draw(t);
      const wait = start + (i * 1000) / fps - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      track.requestFrame();
      opts.onProgress?.(i + 1, times.length);
    }
    await new Promise((r) => setTimeout(r, 1000 / fps));
  } finally {
    rec.stop();
    track.stop();
  }
  await done;
  return new Blob(parts, { type: "video/webm" });
}
