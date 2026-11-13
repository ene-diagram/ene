import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import * as vscode from "vscode";
import {
  buildTimeline,
  checkIcons,
  createIncluder,
  formatSource,
  isIconUrl,
  parse,
  resolveIcon,
  type IncludeResult,
  type Lang,
  type ParseOptions,
  type ResolvedIcon,
} from "@ene-diagram/core";
import { layout, layoutSequence } from "@ene-diagram/layout";
import { renderSvg, type ThemeName } from "@ene-diagram/svg";
import {
  formatEdit,
  nonce,
  parseWebviewMessage,
  previewHtml,
  quickFixEdit,
  splitLines,
  toEditorDiagnostics,
  type EneDiag,
  type Rng,
} from "./pure.js";

const LANG_ID = "ene";
const DEBOUNCE_MS = 250;
const lang = (): Lang => (vscode.env.language.startsWith("ko") ? "ko" : "en");
const toRange = (r: Rng) => new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);

type Included = IncludeResult | { error: string };
/** Key of one `include` lookup, shared with the preview webview (media/preview.js) */
const includeKey = (path: string, from: string | undefined) => `${from ?? ""}\n${path}`;
/**
 * Parse options that resolve `include` next to a document on disk (unsaved and virtual documents get none,
 * so `include` reports E501 there). `seen` collects every lookup, for the preview to replay.
 */
function parseOptionsFor(doc: vscode.TextDocument, seen?: Map<string, Included>): ParseOptions {
  if (doc.uri.scheme !== "file") return {};
  const file = doc.uri.fsPath;
  const read = createIncluder({
    rootDir: dirname(file),
    path: { resolve, dirname, relative, isAbsolute },
    realPath: (p) => realpathSync(p),
    readFile: (p) => readFileSync(p, "utf8"),
  });
  return {
    file,
    include: (path, from) => {
      const r = read(path, from);
      seen?.set(includeKey(path, from), r);
      return r;
    },
  };
}

export function activate(ctx: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection(LANG_ID);
  // Diagnostics with the document version they were computed for; quick fixes are only offered for that version
  const cache = new Map<string, { version: number; diags: EneDiag[] }>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  ctx.subscriptions.push(collection);

  function lint(doc: vscode.TextDocument) {
    if (doc.languageId !== LANG_ID) return;
    const text = doc.getText();
    const { doc: ast, diagnostics } = parse(text, parseOptionsFor(doc));
    diagnostics.push(...checkIcons(ast, []).filter((d) => d.severity === "error"));
    const ds = toEditorDiagnostics(text, diagnostics, lang());
    cache.set(doc.uri.toString(), { version: doc.version, diags: ds });
    collection.set(
      doc.uri,
      ds.map((d) => {
        const v = new vscode.Diagnostic(
          toRange(d.range),
          d.message,
          d.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
        );
        v.code = d.code;
        v.source = "ene";
        return v;
      }),
    );
  }
  function schedule(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        lint(doc);
      }, DEBOUNCE_MS),
    );
  }
  function forget(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.delete(key);
    cache.delete(key);
    collection.delete(doc.uri);
  }

  vscode.workspace.textDocuments.forEach(lint);
  ctx.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(lint),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument(forget),
    { dispose: () => timers.forEach(clearTimeout) },

    vscode.languages.registerCodeActionsProvider(
      LANG_ID,
      {
        provideCodeActions(doc, range) {
          const out: vscode.CodeAction[] = [];
          const cached = cache.get(doc.uri.toString());
          if (!cached || cached.version !== doc.version) return out; // stale while the debounced lint is pending
          const lines = splitLines(doc.getText());
          for (const d of cached.diags) {
            const r = toRange(d.range);
            if (!r.intersection(range)) continue;
            const fix = quickFixEdit(lines, d);
            if (!fix) continue;
            const a = new vscode.CodeAction(`Change to "${fix.newText}"`, vscode.CodeActionKind.QuickFix);
            a.edit = new vscode.WorkspaceEdit();
            a.edit.replace(doc.uri, toRange(fix.range), fix.newText);
            a.isPreferred = true;
            out.push(a);
          }
          return out;
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),

    vscode.languages.registerDocumentFormattingEditProvider(LANG_ID, {
      provideDocumentFormattingEdits(doc) {
        const text = doc.getText();
        const e = formatEdit(text, formatSource(text));
        return e ? [vscode.TextEdit.replace(toRange(e.range), e.newText)] : [];
      },
    }),

    vscode.commands.registerCommand("ene.openPreview", () => {
      const ed = vscode.window.activeTextEditor;
      if (ed?.document.languageId === LANG_ID) Preview.show(ctx, ed.document);
    }),
    vscode.commands.registerCommand("ene.exportSvg", () => exportSvg()),
  );
}

export function deactivate(): void {}

/** One preview panel per document, kept in sync on every edit. */
class Preview {
  private static panels = new Map<string, Preview>();
  private ready = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static show(ctx: vscode.ExtensionContext, doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const existing = Preview.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    Preview.panels.set(key, new Preview(ctx, doc));
  }

  private constructor(
    ctx: vscode.ExtensionContext,
    private readonly doc: vscode.TextDocument,
  ) {
    const media = vscode.Uri.joinPath(ctx.extensionUri, "media");
    this.panel = vscode.window.createWebviewPanel(
      "ene.preview",
      `Preview ${basename(doc.uri)}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [media],
        enableCommandUris: false,
      },
    );
    const w = this.panel.webview;
    w.html = previewHtml({
      cspSource: w.cspSource,
      nonce: nonce(),
      lang: lang(),
      playerUri: w.asWebviewUri(vscode.Uri.joinPath(media, "ene.js")).toString(),
      elkUri: w.asWebviewUri(vscode.Uri.joinPath(media, "ene-elk.js")).toString(),
      scriptUri: w.asWebviewUri(vscode.Uri.joinPath(media, "preview.js")).toString(),
    });
    this.disposables.push(
      w.onDidReceiveMessage((raw) => {
        const m = parseWebviewMessage(raw);
        if (m?.type === "ready") {
          this.ready = true;
          this.post();
        } else if (m?.type === "error") void vscode.window.showWarningMessage(`ene preview: ${m.message}`);
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === this.doc) this.schedule();
      }),
      vscode.workspace.onDidCloseTextDocument((d) => {
        if (d === this.doc) this.panel.dispose();
      }),
    );
    this.panel.onDidDispose(() => this.dispose());
  }
  private readonly panel: vscode.WebviewPanel;

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.post(), DEBOUNCE_MS);
  }
  private post() {
    if (!this.ready) return;
    const text = this.doc.getText();
    // The webview cannot read files: parse once here and send it what the `include` lines resolved to
    const seen = new Map<string, Included>();
    const opts = parseOptionsFor(this.doc, seen);
    if (opts.include) parse(text, opts);
    void this.panel.webview.postMessage({ type: "update", text, file: opts.file, includes: [...seen] });
  }
  private dispose() {
    clearTimeout(this.timer);
    Preview.panels.delete(this.doc.uri.toString());
    this.disposables.forEach((d) => {
      d.dispose();
    });
  }
}

const basename = (u: vscode.Uri) => u.path.split("/").pop() ?? "";

async function exportSvg() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.languageId !== LANG_ID) {
    void vscode.window.showErrorMessage("ene: open an .ene file first");
    return;
  }
  const text = ed.document.getText();
  const { doc, diagnostics } = parse(text, parseOptionsFor(ed.document));
  diagnostics.push(...checkIcons(doc, []));
  if (diagnostics.some((d) => d.severity === "error")) {
    void vscode.window.showErrorMessage("ene: fix the errors before exporting (see Problems)");
    return;
  }
  const src = ed.document.uri;
  const defaultUri =
    src.scheme === "untitled" ? undefined : src.with({ path: `${src.path.replace(/\.[^./]+$/, "")}.svg` });
  const target = await vscode.window.showSaveDialog({ defaultUri, filters: { SVG: ["svg"] } });
  if (!target) return;
  const tl = buildTimeline(doc, { choices: [] });
  // Icons from packs are not bundled; URL icons are skipped (no network access from the export).
  const icons = new Map<string, ResolvedIcon>();
  for (const n of doc.nodes.values())
    if (n.icon && !isIconUrl(n.icon)) {
      const ic = resolveIcon(n.icon, []);
      if (ic) icons.set(n.icon, ic);
    }
  try {
    const lay = doc.kind === "sequence" ? layoutSequence(doc, tl) : await layout(doc, tl);
    const svg = renderSvg(lay, tl, { title: doc.title, icons, theme: doc.theme as ThemeName | undefined });
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(svg));
    void vscode.window.showInformationMessage(
      `ene: exported ${basename(target)} (${tl.steps.length} steps, ${tl.total.toFixed(1)}s)`,
    );
  } catch (e) {
    void vscode.window.showErrorMessage(`ene: export failed: ${(e as Error).message}`);
  }
}
