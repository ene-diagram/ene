// Webview side of the ene preview. Receives the document text from the extension and renders it with the player.
(() => {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");
  let latest = null,
    busy = false;
  // Included files as the extension resolved them: [key, { source, file } | { error }], key = from + "\n" + path
  let includes = new Map(),
    file;
  const include = (path, from) =>
    includes.get(`${from ?? file ?? ""}\n${path}`) ?? { error: "not available in the preview" };
  async function draw() {
    if (busy) return;
    busy = true;
    try {
      while (latest !== null) {
        const text = latest;
        latest = null;
        try {
          await window.ene.render(root, text, includes.size ? { include } : {});
        } catch (e) {
          vscode.postMessage({ type: "error", message: String(e?.message || e) });
        }
      }
    } finally {
      busy = false;
    }
  }
  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (m?.type !== "update" || typeof m.text !== "string") return;
    includes = new Map(Array.isArray(m.includes) ? m.includes : []);
    file = typeof m.file === "string" ? m.file : undefined;
    latest = m.text;
    void draw();
  });
  vscode.postMessage({ type: "ready" });
})();
