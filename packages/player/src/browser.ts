import { autoRun, render, registerIconPacks, setElkUrl, setIconLoading } from "./player.js";
import { createController } from "./controller.js";
export { render, autoRun, registerIconPacks, setElkUrl, setIconLoading, createController };
// ene-elk.js is looked up in the same folder as ene.js by default
const me = typeof document !== "undefined" ? (document.currentScript as HTMLScriptElement | null)?.src : undefined;
if (me) setElkUrl(new URL("ene-elk.js", me).href);
declare global { interface Window { eneConfig?: { startOnLoad?: boolean; lang?: "en" | "ko"; elkUrl?: string } } }
if (typeof window !== "undefined" && window.eneConfig?.elkUrl) setElkUrl(window.eneConfig.elkUrl);
if (typeof window !== "undefined" && window.eneConfig?.startOnLoad !== false) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void autoRun(undefined, { lang: window.eneConfig?.lang }));
  else void autoRun(undefined, { lang: window.eneConfig?.lang });
}
