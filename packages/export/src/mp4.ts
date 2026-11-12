// Minimal MP4 (ISO BMFF) muxer for one H.264 video track, as produced by WebCodecs with
// `avc: { format: "avc" }` (length-prefixed samples, avcC from decoderConfig.description).
// All samples go into one chunk; moov comes before mdat so playback can start early.

export interface Mp4Sample { data: Uint8Array; key: boolean }
export interface Mp4Options { width: number; height: number; fps: number; avcC: Uint8Array }

const TIMESCALE = 90000;
const str = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u16 = (v: number) => [(v >> 8) & 255, v & 255];
const zeros = (n: number) => new Array<number>(n).fill(0);

type Part = number[] | Uint8Array;
const flat = (parts: Part[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const box = (type: string, ...parts: Part[]): Uint8Array => {
  const body = flat(parts);
  return flat([u32(body.length + 8), str(type), body]);
};
const full = (type: string, version: number, flags: number, ...parts: Part[]) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
const MATRIX = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

function moov(o: Mp4Options, samples: Mp4Sample[], dataOffset: number): Uint8Array {
  const delta = Math.round(TIMESCALE / o.fps), duration = delta * samples.length;
  const ms = Math.round((duration / TIMESCALE) * 1000);
  const keys = samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  const avc1 = box("avc1", zeros(6), u16(1), zeros(16), u16(o.width), u16(o.height), u32(0x480000), u32(0x480000), u32(0), u16(1),
    zeros(32), u16(0x18), u16(0xffff), box("avcC", o.avcC));
  const stbl = box("stbl",
    full("stsd", 0, 0, u32(1), avc1),
    full("stts", 0, 0, u32(1), u32(samples.length), u32(delta)),
    full("stss", 0, 0, u32(keys.length), ...keys.map(u32)),
    full("stsc", 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
    full("stsz", 0, 0, u32(0), u32(samples.length), ...samples.map((s) => u32(s.data.length))),
    full("stco", 0, 0, u32(1), u32(dataOffset)));
  const minf = box("minf", full("vmhd", 0, 1, zeros(8)), box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))), stbl);
  const mdia = box("mdia",
    full("mdhd", 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(duration), u16(0x55c4), u16(0)),
    full("hdlr", 0, 0, u32(0), str("vide"), zeros(12), str("VideoHandler"), [0]),
    minf);
  const trak = box("trak",
    full("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(ms), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(o.width << 16), u32(o.height << 16)),
    mdia);
  return box("moov",
    full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(ms), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
    trak);
}

export function muxMp4(o: Mp4Options, samples: Mp4Sample[]): Uint8Array {
  if (!samples.length) throw new Error("no frames");
  const ftyp = box("ftyp", str("isom"), u32(0x200), str("isom"), str("iso2"), str("avc1"), str("mp41"));
  const size = moov(o, samples, 0).length;
  const mdatLen = samples.reduce((n, s) => n + s.data.length, 0) + 8;
  return flat([ftyp, moov(o, samples, ftyp.length + size + 8), u32(mdatLen), str("mdat"), ...samples.map((s) => s.data)]);
}
