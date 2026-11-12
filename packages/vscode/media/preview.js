// Webview side of the ene preview. Receives the document text from the extension and renders it with the player.
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");
  let latest = null, busy = false;
  async function draw() {
    if (busy) return;
    busy = true;
    try {
      while (latest !== null) {
        const text = latest;
        latest = null;
        try { await window.ene.render(root, text); }
        catch (e) { vscode.postMessage({ type: "error", message: String(e && e.message || e) }); }
      }
    } finally { busy = false; }
  }
  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (!m || m.type !== "update" || typeof m.text !== "string") return;
    latest = m.text;
    void draw();
  });
  vscode.postMessage({ type: "ready" });
})();
