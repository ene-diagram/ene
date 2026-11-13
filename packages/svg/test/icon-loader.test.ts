import { createServer } from "node:http";
import { fetchIcon, iconFromUntrustedSvg } from "../src/index";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect/></svg>';
const res = (body: BodyInit | null, init?: ResponseInit) => new Response(body, init);
const fake = (r: Response | ((signal: AbortSignal) => Promise<Response>)) =>
  (async (_u: unknown, init?: RequestInit) => (typeof r === "function" ? r(init!.signal!) : r)) as typeof fetch;

test("loads a valid svg", async () => {
  const r = await fetchIcon("https://x.io/a.svg", { fetch: fake(res(SVG)) });
  expect(r).toMatchObject({ ok: true, icon: { width: 24, height: 24 } });
});
test("times out a hanging request", async () => {
  const hang = (signal: AbortSignal) =>
    new Promise<Response>((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
  const r = await fetchIcon("https://x.io/a.svg", { fetch: fake(hang), timeoutMs: 20 });
  expect(r).toEqual({ ok: false, reason: "timed out after 20 ms" });
});
test("rejects oversized responses by content-length and while streaming", async () => {
  const big = "x".repeat(2000);
  const byHeader = await fetchIcon("https://x.io/a.svg", {
    fetch: fake(res(big, { headers: { "content-length": "2000" } })),
    maxBytes: 1000,
  });
  expect(byHeader.ok).toBe(false);
  expect(!byHeader.ok && byHeader.reason).toContain("too large");
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(new Uint8Array(400));
    },
  }); // endless, no length header
  const streamed = await fetchIcon("https://x.io/a.svg", { fetch: fake(res(stream)), maxBytes: 1000 });
  expect(streamed.ok).toBe(false);
  expect(!streamed.ok && streamed.reason).toContain("too large");
});
test("reports HTTP errors, non-svg bodies, bad schemes and disallowed hosts", async () => {
  expect(await fetchIcon("https://x.io/a.svg", { fetch: fake(res("no", { status: 404 })) })).toEqual({
    ok: false,
    reason: "HTTP 404",
  });
  expect(await fetchIcon("https://x.io/a.svg", { fetch: fake(res("<html></html>")) })).toEqual({
    ok: false,
    reason: "response is not an SVG document",
  });
  expect((await fetchIcon("file:///etc/passwd")).ok).toBe(false);
  expect(await fetchIcon("https://evil.io/a.svg", { allowHosts: ["x.io"], fetch: fake(res(SVG)) })).toEqual({
    ok: false,
    reason: "host evil.io is not allowed",
  });
  expect((await fetchIcon("https://x.io/a.svg", { allowHosts: ["x.io"], fetch: fake(res(SVG)) })).ok).toBe(true);
});
test("iconFromUntrustedSvg rejects absurd viewBox sizes", () => {
  expect(iconFromUntrustedSvg('<svg viewBox="0 0 99999 10"></svg>').ok).toBe(false);
  expect(iconFromUntrustedSvg(`<?xml version="1.0"?>\n${SVG}`).ok).toBe(true);
});

test.each([404, 500])("closes an unfinished HTTP %i response without waiting for its body", async (status) => {
  let closed = false;
  const server = createServer((_req, res) => {
    res.on("close", () => {
      closed = true;
    });
    res.writeHead(status, { "content-type": "image/svg+xml" });
    res.write("<svg>"); // Leave the body open, as a stalled server would.
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server address");
    const result = await fetchIcon(`http://127.0.0.1:${address.port}/icon.svg`, { timeoutMs: 2000 });
    expect(result).toEqual({ ok: false, reason: `HTTP ${status}` });
    await vi.waitFor(() => expect(closed).toBe(true), { timeout: 500 });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
