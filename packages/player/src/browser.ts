import { autoRun, render, registerIconPacks, setElkUrl, setIconLoading } from "./player.js";
import { createController } from "./controller.js";
export { render, autoRun, registerIconPacks, setElkUrl, setIconLoading, createController };
declare global {
  interface Window {
    eneConfig?: {
      startOnLoad?: boolean;
      lang?: "en" | "ko";
      elkUrl?: string;
      focus?: boolean | "auto";
      theme?: import("@ene-diagram/svg").ThemeName;
    };
  }
}
// This bundle does not contain elkjs, so it always loads ene-elk.js: the configured URL, else the file next to
// ene.js, else a relative "ene-elk.js"
const me = typeof document !== "undefined" ? (document.currentScript as HTMLScriptElement | null)?.src : undefined;
setElkUrl(
  (typeof window !== "undefined" && window.eneConfig?.elkUrl) || (me ? new URL("ene-elk.js", me).href : "ene-elk.js"),
);
if (typeof window !== "undefined" && window.eneConfig?.startOnLoad !== false) {
  if (document.readyState === "loading")
    document.addEventListener(
      "DOMContentLoaded",
      () =>
        void autoRun(undefined, {
          lang: window.eneConfig?.lang,
          focus: window.eneConfig?.focus,
          theme: window.eneConfig?.theme,
        }),
    );
  else
    void autoRun(undefined, {
      lang: window.eneConfig?.lang,
      focus: window.eneConfig?.focus,
      theme: window.eneConfig?.theme,
    });
}
