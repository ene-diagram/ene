import { describe, expect, it } from "vitest";
import { GifEncoder, encodeGif, lzw, muxMp4 } from "../src/index.js";

/** Minimal GIF LZW decoder (for checking the encoder) */
function unlzw(data: Uint8Array, at: number): { out: number[]; end: number } {
  const min = data[at++];
  const bytes: number[] = [];
  for (let n = data[at++]; n; n = data[at++]) { bytes.push(...data.subarray(at, at + n)); at += n; }
  const clear = 1 << min, eoi = clear + 1;
  let size = min + 1, dict: number[][] = [], prev: number[] | undefined, pos = 0;
  const reset = () => { dict = Array.from({ length: clear + 2 }, (_, i) => [i]); size = min + 1; prev = undefined; };
  reset();
  const out: number[] = [];
  const read = () => { let v = 0; for (let i = 0; i < size; i++, pos++) v |= ((bytes[pos >> 3] >> (pos & 7)) & 1) << i; return v; };
  for (;;) {
    const c = read();
    if (c === clear) { reset(); continue; }
    if (c === eoi) break;
    const entry = c < dict.length ? dict[c] : [...prev!, prev![0]];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  return { out, end: at };
}

describe("lzw", () => {
  it("round-trips short, repetitive and table-filling inputs", () => {
    const rnd = (n: number, k: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7919 + ((i * i) >> 3)) % k);
    for (const input of [new Uint8Array([5]), new Uint8Array(1000).fill(3), rnd(20000, 256), rnd(50000, 17)]) {
      const enc = lzw(input).result();
      expect(unlzw(enc, 0).out).toEqual([...input]);
    }
  });
});

describe("encodeGif", () => {
  const frame = (rgb: [number, number, number]) => ({ width: 4, height: 2, data: Uint8ClampedArray.from({ length: 32 }, (_, i) => (i % 4 === 3 ? 255 : rgb[i % 4])) });
  it("writes a looping GIF89a, merging repeated frames into one longer frame", () => {
    const gif = encodeGif([frame([255, 0, 0]), frame([255, 0, 0]), frame([0, 0, 255])], 10);
    expect(String.fromCharCode(...gif.subarray(0, 6))).toBe("GIF89a");
    expect(gif[6] | (gif[7] << 8)).toBe(4);
    expect(String.fromCharCode(...gif.subarray(gif.indexOf(0x4e), gif.indexOf(0x4e) + 11))).toBe("NETSCAPE2.0");
    expect(gif[gif.length - 1]).toBe(0x3b);
    // Graphic control extensions: delays of 20 cs (two merged frames) and 10 cs
    const delays: number[] = [];
    for (let i = 0; i < gif.length - 3; i++) if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 4) delays.push(gif[i + 4] | (gif[i + 5] << 8));
    expect(delays).toEqual([20, 10]);
  });
  it("stores only the changed rectangle after the first frame", () => {
    const a = frame([255, 0, 0]), b = frame([255, 0, 0]);
    b.data.set([0, 0, 255, 255], (1 * 4 + 2) * 4); // pixel (2, 1)
    const gif = encodeGif([a, b], 10);
    const desc: number[][] = [];
    for (let i = 0; i < gif.length - 9; i++) if (gif[i] === 0x2c && gif[i - 8] === 0x21 && gif[i - 7] === 0xf9) desc.push([0, 2, 4, 6].map((o) => gif[i + 1 + o] | (gif[i + 2 + o] << 8)));
    expect(desc).toEqual([[0, 0, 4, 2], [2, 1, 1, 1]]);
  });
});

describe("GifEncoder", () => {
  it("keeps the loop length at the maximum frame rate and refuses more", () => {
    const pal = new Uint8Array([0, 0, 0, 255, 0, 0]);
    const enc = new GifEncoder(1, 1, pal, 50);
    for (let i = 0; i < 50; i++) enc.add({ width: 1, height: 1, data: new Uint8Array([i % 2 ? 255 : 0, 0, 0, 255]) });
    const gif = enc.finish();
    let total = 0;
    for (let i = 0; i < gif.length - 5; i++) if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 4) total += gif[i + 4] | (gif[i + 5] << 8);
    expect(total).toBe(100);
    expect(() => new GifEncoder(1, 1, pal, 60)).toThrow(/50 fps/);
  });
});

describe("muxMp4", () => {
  it("lays out ftyp, moov and mdat with the sample table pointing into mdat", () => {
    const samples = [{ data: new Uint8Array([1, 2, 3]), key: true }, { data: new Uint8Array([4, 5]), key: false }];
    const mp4 = muxMp4({ width: 64, height: 32, fps: 30, avcC: new Uint8Array([1, 0x64, 0, 0x1f]) }, samples);
    const top: [string, number, number][] = [];
    const dv = new DataView(mp4.buffer);
    for (let o = 0; o < mp4.length; ) { const n = dv.getUint32(o); top.push([String.fromCharCode(...mp4.subarray(o + 4, o + 8)), o, n]); o += n; }
    expect(top.map((t) => t[0])).toEqual(["ftyp", "moov", "mdat"]);
    const mdat = top[2];
    const stco = mp4.findIndex((_, i) => String.fromCharCode(...mp4.subarray(i, i + 4)) === "stco");
    // type, version/flags, entry count, then the chunk offset
    expect(dv.getUint32(stco + 12)).toBe(mdat[1] + 8);
    expect([...mp4.subarray(mdat[1] + 8)]).toEqual([1, 2, 3, 4, 5]);
  });
});
