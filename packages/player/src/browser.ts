import { autoRun, parseStepLink, render, registerIconPacks, setElkUrl, setIconLoading } from "./player.js";
import { createController } from "./controller.js";
export { render, autoRun, parseStepLink, registerIconPacks, setElkUrl, setIconLoading, createController };
// ene-elk.js is looked up in the same folder as ene.js by default
const me = typeof document !== "undefined" ? (document.currentScript as HTMLScriptElement | null)?.src : undefined;
if (me) setElkUrl(new URL("ene-elk.js", me).href);
declare global {
  interface Window {
    eneConfig?: {
      startOnLoad?: boolean;
      lang?: "en" | "ko";
      elkUrl?: string;
      focus?: boolean | "auto";
      theme?: import("@ene-diagram/svg").ThemeName;
      /** Zoom buttons and gestures on every player (default true) */
      zoom?: boolean;
    };
  }
}
if (typeof window !== "undefined" && window.eneConfig?.elkUrl) setElkUrl(window.eneConfig.elkUrl);
if (typeof window !== "undefined" && window.eneConfig?.startOnLoad !== false) {
  const start = () =>
    void autoRun(undefined, {
      lang: window.eneConfig?.lang,
      focus: window.eneConfig?.focus,
      theme: window.eneConfig?.theme,
      zoom: window.eneConfig?.zoom,
    });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
