// A small dependency-free GIF89a encoder: one global 256-colour palette built from a sample of the
// frames (ene diagrams use few colours, so a popularity palette on 15-bit colour works well),
// nearest-colour mapping and LZW compression. Frames that repeat the previous one are merged into
// a longer delay, which keeps held steps cheap.

export interface GifFrame {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Growable byte buffer */
export class Bytes {
  private buf = new Uint8Array(1 << 16);
  length = 0;
  private room(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.length));
    this.buf = b;
  }
  push(...v: number[]) {
    this.room(v.length);
    for (const x of v) this.buf[this.length++] = x;
  }
  byte(v: number) {
    this.room(1);
    this.buf[this.length++] = v;
  }
  bytes(v: ArrayLike<number>) {
    this.room(v.length);
    this.buf.set(v, this.length);
    this.length += v.length;
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

const key15 = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/** Up to 256 colours (RGB triples) for the given frames */
export function buildPalette(frames: GifFrame[], maxSamples = 12): Uint8Array {
  const count = new Uint32Array(32768),
    sum = new Float64Array(32768 * 3);
  const step = Math.max(1, Math.floor(frames.length / maxSamples));
  for (let f = 0; f < frames.length; f += step) {
    const d = frames[f].data;
    for (let i = 0; i < d.length; i += 4) {
      const k = key15(d[i], d[i + 1], d[i + 2]);
      count[k]++;
      sum[k * 3] += d[i];
      sum[k * 3 + 1] += d[i + 1];
      sum[k * 3 + 2] += d[i + 2];
    }
  }
  const keys = [];
  for (let k = 0; k < 32768; k++) if (count[k]) keys.push(k);
  keys.sort((a, b) => count[b] - count[a]);
  const top = keys.slice(0, 256);
  const pal = new Uint8Array(256 * 3);
  top.forEach((k, i) => {
    for (let c = 0; c < 3; c++) pal[i * 3 + c] = Math.round(sum[k * 3 + c] / count[k]);
  });
  return pal.subarray(0, Math.max(2, top.length) * 3);
}

function indexer(pal: Uint8Array): (r: number, g: number, b: number) => number {
  const n = pal.length / 3,
    cache = new Int16Array(32768).fill(-1);
  return (r, g, b) => {
    const k = key15(r, g, b);
    let hit = cache[k];
    if (hit < 0) {
      let best = 0,
        bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const dr = pal[i * 3] - r,
          dg = pal[i * 3 + 1] - g,
          db = pal[i * 3 + 2] - b;
        const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      hit = cache[k] = best;
    }
    return hit;
  };
}

/** LZW-compress colour indices into GIF image data sub-blocks (minimum code size 8) */
export function lzw(indices: Uint8Array, minCode = 8, out = new Bytes()): Bytes {
  out.byte(minCode);
  const clear = 1 << minCode,
    eoi = clear + 1;
  let size = minCode + 1,
    next = eoi + 1;
  let dict = new Map<number, number>();
  let acc = 0,
    bits = 0;
  const block = new Uint8Array(255);
  let used = 0;
  // The code width grows after the code that follows the entry filling the current width
  // (the decoder adds its entries one code late), and resets after a clear code
  const emit = (code: number) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      block[used++] = acc & 255;
      acc >>>= 8;
      bits -= 8;
      if (used === 255) {
        out.byte(255);
        out.bytes(block);
        used = 0;
      }
    }
    if (code === clear) size = minCode + 1;
    else if (next >= 1 << size && size < 12) size++;
  };
  emit(clear);
  if (indices.length) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const c = indices[i],
        k = (prefix << 8) | c;
      const found = dict.get(k);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      emit(prefix);
      if (next < 4096) dict.set(k, next++);
      else {
        dict = new Map();
        next = eoi + 1;
        emit(clear);
      }
      prefix = c;
    }
    emit(prefix);
  }
  emit(eoi);
  if (bits > 0) block[used++] = acc & 255;
  if (used) {
    out.byte(used);
    out.bytes(block.subarray(0, used));
  }
  out.byte(0);
  return out;
}

/** GIF delays are whole centiseconds and browsers treat delays under 2 cs as slow, so 50 fps is the most a GIF can show */
export const GIF_MAX_FPS = 50;

/**
 * Streaming GIF encoder: frames are quantised and compressed as they arrive, so only the previous
 * frame's colour indices are kept. Each frame after the first stores only the rectangle that
 * changed (disposal: keep the previous frame); a frame equal to the previous one extends its delay.
 */
export class GifEncoder {
  private bytes = new Bytes();
  private index: (r: number, g: number, b: number) => number;
  private prev: Uint8Array | undefined;
  private pending: { idx: Uint8Array; start: number } | undefined;
  private count = 0;
  constructor(
    private width: number,
    private height: number,
    palette: Uint8Array,
    private fps: number,
  ) {
    if (!(fps > 0 && fps <= GIF_MAX_FPS)) throw new Error(`a GIF can show at most ${GIF_MAX_FPS} fps`);
    this.index = indexer(palette);
    const palBits = Math.max(1, Math.ceil(Math.log2(palette.length / 3)));
    const b = this.bytes,
      u16 = (v: number) => b.push(v & 255, (v >> 8) & 255);
    b.push(...[..."GIF89a"].map((c) => c.charCodeAt(0)));
    u16(width);
    u16(height);
    b.push(0x80 | ((palBits - 1) << 4) | (palBits - 1), 0, 0);
    const table = new Uint8Array((1 << palBits) * 3);
    table.set(palette);
    b.bytes(table);
    // NETSCAPE2.0: loop forever
    b.push(0x21, 0xff, 11, ...[..."NETSCAPE2.0"].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  }
  add(frame: GifFrame): void {
    if (frame.width !== this.width || frame.height !== this.height)
      throw new Error("all frames must have the same size");
    const d = frame.data,
      idx = new Uint8Array(this.width * this.height);
    for (let p = 0, q = 0; p < idx.length; p++, q += 4) idx[p] = this.index(d[q], d[q + 1], d[q + 2]);
    const n = this.count++;
    if (this.pending && sameIndices(this.pending.idx, idx)) return;
    this.flush(n);
    this.pending = { idx, start: n };
  }
  /** Write the pending frame, which lasts until frame `end` starts */
  private flush(end: number) {
    const f = this.pending;
    if (!f) return;
    const { width, height } = this,
      b = this.bytes;
    // Frame i starts at round(i * 100 / fps) centiseconds, so rounding never drifts
    const cs = (i: number) => Math.round((i * 100) / this.fps);
    let delay = Math.max(2, cs(end) - cs(f.start));
    let x0 = 0,
      y0 = 0,
      x1 = width - 1,
      y1 = height - 1;
    const prev = this.prev,
      idx = f.idx;
    if (prev) {
      x0 = width;
      y0 = height;
      x1 = -1;
      y1 = -1;
      for (let y = 0; y < height; y++)
        for (let x = 0, p = y * width; x < width; x++, p++)
          if (idx[p] !== prev[p]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
      if (x1 < 0) {
        x0 = y0 = x1 = y1 = 0;
      }
    }
    const w = x1 - x0 + 1,
      h = y1 - y0 + 1;
    const rect = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) rect.set(idx.subarray((y0 + y) * width + x0, (y0 + y) * width + x0 + w), y * w);
    // The delay field is 16 bits: a longer hold continues in 1-pixel frames that repeat pixel (0, 0)
    const gce = (d: number) => b.push(0x21, 0xf9, 4, 0x04, d & 255, (d >> 8) & 255, 0, 0);
    gce(Math.min(delay, 0xffff));
    b.push(0x2c, x0 & 255, x0 >> 8, y0 & 255, y0 >> 8, w & 255, w >> 8, h & 255, h >> 8, 0);
    lzw(rect, 8, b);
    for (delay -= 0xffff; delay > 0; delay -= 0xffff) {
      gce(Math.max(2, Math.min(delay, 0xffff)));
      b.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0);
      lzw(idx.subarray(0, 1), 8, b);
    }
    this.prev = idx;
    this.pending = undefined;
  }
  finish(): Uint8Array {
    if (!this.count) throw new Error("no frames");
    this.flush(this.count);
    this.bytes.byte(0x3b);
    return this.bytes.result();
  }
}

const sameIndices = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Encode RGBA frames (all the same size) as a looping GIF */
export function encodeGif(frames: GifFrame[], fps: number): Uint8Array {
  if (!frames.length) throw new Error("no frames");
  const enc = new GifEncoder(frames[0].width, frames[0].height, buildPalette(frames), fps);
  for (const f of frames) enc.add(f);
  return enc.finish();
}
