import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VideoError,
  environment,
  ffmpegArgs,
  findChrome,
  findFfmpeg,
  formatOf,
  frameTimes,
  hasLibx264,
  renderVideo,
  svgSize,
} from "../src/index";

const root = new URL("../../..", import.meta.url).pathname;
const bin = join(root, "packages/cli/bin/ene.mjs");
const SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 121 61" width="121" height="61">` +
  `<rect width="100%" height="100%" fill="#fff"/><rect y="20" width="20" height="20" fill="#f00">` +
  `<animate attributeName="x" values="0;100" dur="1s" repeatCount="indefinite"/></rect></svg>`;

test("formatOf reads the extension", () => {
  expect([formatOf("a.gif"), formatOf("b/c.MP4"), formatOf("a.svg"), formatOf("gif")]).toEqual([
    "gif",
    "mp4",
    undefined,
    undefined,
  ]);
});
test("svgSize reads the root size and rejects an SVG without one", () => {
  expect(svgSize(SVG)).toEqual({ width: 121, height: 61 });
  expect(svgSize(`<svg width="10.2" height="5"><rect width="999" height="999"/></svg>`)).toEqual({
    width: 11,
    height: 5,
  });
  expect(() => svgSize(`<svg viewBox="0 0 1 1"/>`)).toThrow(VideoError);
});
test("frameTimes covers one loop without repeating its first frame", () => {
  expect(frameTimes(1, 4)).toEqual([0, 0.25, 0.5, 0.75]);
  expect(frameTimes(0.01, 20)).toEqual([0]);
  expect(frameTimes(4.8, 20)).toHaveLength(96);
});
test("ffmpeg arguments per format", () => {
  const gif = ffmpegArgs("gif", 20, "o.gif"),
    mp4 = ffmpegArgs("mp4", 30, "o.mp4");
  expect(gif.slice(gif.indexOf("-framerate"), gif.indexOf("-framerate") + 2)).toEqual(["-framerate", "20"]);
  expect(gif.join(" ")).toContain("palettegen");
  expect(gif.slice(-3)).toEqual(["-f", "gif", "o.gif"]);
  expect(mp4.join(" ")).toContain("-pix_fmt yuv420p");
  expect(mp4.join(" ")).toContain("pad=ceil(iw/2)*2");
  expect(mp4.at(-1)).toBe("o.mp4");
});
test("ENE_CHROME / ENE_FFMPEG override discovery and a missing path is not used", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-video-test-"));
  const f = join(d, "tool");
  writeFileSync(f, "");
  expect(findChrome({ ENE_CHROME: f })).toBe(f);
  expect(findChrome({ ENE_CHROME: join(d, "nope") })).toBeUndefined();
  expect(findFfmpeg({ ENE_FFMPEG: f })).toBe(f);
  expect(findFfmpeg({ ENE_FFMPEG: join(d, "nope") })).toBeUndefined();
  writeFileSync(join(d, "ffmpeg"), "");
  expect(findFfmpeg({ PATH: d })).toBe(join(d, "ffmpeg"));
  expect(findFfmpeg({ PATH: "" })).toBeUndefined();
});
test("bad options are rejected before anything is started", async () => {
  const base = { out: join(tmpdir(), "never.gif"), format: "gif" as const, seconds: 1 };
  await expect(renderVideo(SVG, { ...base, fps: 0 })).rejects.toThrow("fps must be between");
  await expect(renderVideo(SVG, { ...base, scale: 9 })).rejects.toThrow("scale must be between");
  await expect(renderVideo(SVG, { ...base, seconds: 0 })).rejects.toThrow("no length");
  await expect(renderVideo(SVG, { ...base, seconds: 600, fps: 60 })).rejects.toThrow("the limit is 3600");
  await expect(renderVideo(SVG, { ...base, seconds: 1e12 })).rejects.toThrow(VideoError);
  expect(existsSync(base.out)).toBe(false);
});

const env = environment();
const canRender = !!(env.chrome && env.ffmpeg && env.websocket);
const probe = (file: string, entries: string) =>
  execFileSync(
    join(env.ffmpeg!, "..", "ffprobe"),
    ["-v", "error", "-count_frames", "-show_entries", `stream=${entries}`, "-of", "csv=p=0", file],
    { encoding: "utf8" },
  ).trim();
const hasProbe = canRender && existsSync(join(env.ffmpeg!, "..", "ffprobe"));

describe.skipIf(!canRender)("rendering (needs Chrome and ffmpeg)", () => {
  test("gif: one frame per time step, the animation actually moves", async () => {
    const d = mkdtempSync(join(tmpdir(), "ene-video-test-"));
    const out = join(d, "o.gif");
    const seen: number[] = [];
    const r = await renderVideo(SVG, { out, format: "gif", seconds: 1, fps: 5, onFrame: (n) => seen.push(n) });
    expect(r).toEqual({ frames: 5, fps: 5, width: 121, height: 61 });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(readFileSync(out).subarray(0, 6).toString("latin1")).toBe("GIF89a");
    if (!hasProbe) return;
    expect(probe(out, "width,height,nb_read_frames")).toBe("121,61,5");
    // The red square is at x=0 in frame 0 and x=60 in frame 3: column 70 is white first, red later
    const px = (frame: number) =>
      execFileSync(env.ffmpeg!, [
        "-v",
        "error",
        "-i",
        out,
        "-vf",
        `select=eq(n\\,${frame}),crop=1:1:70:30`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ]);
    expect([...px(0)]).toEqual([255, 255, 255]);
    expect(px(3)[0]).toBeGreaterThan(200);
    expect(px(3)[1]).toBeLessThan(60);
  }, 60_000);

  test.skipIf(!canRender || !hasLibx264(env.ffmpeg!))(
    "mp4: scaled, padded to even dimensions",
    async () => {
      const d = mkdtempSync(join(tmpdir(), "ene-video-test-"));
      const out = join(d, "o.mp4");
      const r = await renderVideo(SVG, { out, format: "mp4", seconds: 0.5, fps: 10, scale: 1 });
      expect(r.frames).toBe(5);
      expect(readFileSync(out).subarray(4, 8).toString("latin1")).toBe("ftyp");
      if (hasProbe) expect(probe(out, "width,height,nb_read_frames")).toBe("122,62,5");
    },
    60_000,
  );

  test("an unwritable destination is a plain error and leaves no partial file", async () => {
    const d = mkdtempSync(join(tmpdir(), "ene-video-test-"));
    const out = join(d, "missing-dir", "o.gif");
    await expect(renderVideo(SVG, { out, format: "gif", seconds: 0.2, fps: 5 })).rejects.toThrow(
      /cannot write .*o\.gif \(ENOENT\)/,
    );
    expect(existsSync(out)).toBe(false);
  }, 60_000);

  test("a failed export keeps the file that was already at the destination", async () => {
    const d = mkdtempSync(join(tmpdir(), "ene-video-test-"));
    const out = join(d, "o.gif");
    writeFileSync(out, "previous export");
    const notABrowser = join(d, "not-a-browser");
    writeFileSync(notABrowser, "");
    const before = process.env.ENE_CHROME;
    process.env.ENE_CHROME = notABrowser;
    try {
      await expect(renderVideo(SVG, { out, format: "gif", seconds: 0.2, fps: 5 })).rejects.toThrow(VideoError);
    } finally {
      if (before === undefined) delete process.env.ENE_CHROME;
      else process.env.ENE_CHROME = before;
    }
    expect(readFileSync(out, "utf8")).toBe("previous export");
    await renderVideo(SVG, { out, format: "gif", seconds: 0.2, fps: 5 });
    expect(readFileSync(out).subarray(0, 6).toString("latin1")).toBe("GIF89a");
  }, 60_000);

  test("CLI: -o x.gif renders the chosen branch; --fps and --scale apply", () => {
    execFileSync("pnpm", ["exec", "tsc", "-b", "packages/cli"], { cwd: root });
    const d = mkdtempSync(join(tmpdir(), "ene-video-test-"));
    const f = join(d, "f.ene");
    const out = join(d, "f.gif");
    writeFileSync(f, "speed 0.2\na -> b : go\nbranch ok\n  b --> a : ok\nelse fail\n  b -x a : no\nend\n");
    const r = spawnSync("node", [bin, f, "-o", out, "--choice", "1", "--fps", "5", "--scale", "0.5"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/✅ .*f\.gif \(2 steps, 0\.4s, 10 frames at 5 fps, \d+×\d+\)/);
    expect(readFileSync(out).subarray(0, 6).toString("latin1")).toBe("GIF89a");
  }, 60_000);
});

test("CLI: missing tools and bad options are plain errors, not stack traces", () => {
  execFileSync("pnpm", ["exec", "tsc", "-b", "packages/cli"], { cwd: root });
  const d = mkdtempSync(join(tmpdir(), "ene-video-test-"));
  const f = join(d, "f.ene");
  writeFileSync(f, "a -> b\n");
  const run = (args: string[], extra: Record<string, string> = {}) =>
    spawnSync("node", [bin, f, ...args], { encoding: "utf8", env: { ...process.env, ...extra } });
  const noChrome = run(["-o", join(d, "x.gif")], { ENE_CHROME: join(d, "nope") });
  expect(noChrome.status).toBe(1);
  expect(noChrome.stderr).toMatch(/^error: GIF\/MP4 export needs (Chrome|Node\.js 22)/m);
  expect(noChrome.stderr).not.toContain("    at ");
  expect(existsSync(join(d, "x.gif"))).toBe(false);
  expect(run(["-o", join(d, "x.gif"), "--fps", "0"]).status).toBe(2);
  expect(run(["-o", join(d, "x.gif"), "--fps", "500"]).stderr).toContain("fps must be between");
  const svg = run(["-o", join(d, "x.svg"), "--fps", "10"]);
  expect(svg.status).toBe(0);
  expect(svg.stderr).toContain("--fps and --scale only apply");
});
