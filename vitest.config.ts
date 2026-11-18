import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const src = (p: string) => new URL(`./packages/${p}/src/index.ts`, import.meta.url).pathname;
const alias = {
  "@ene-diagram/core": src("core"),
  "@ene-diagram/layout": src("layout"),
  "@ene-diagram/svg": src("svg"),
  "@ene-diagram/player": src("player"),
  "@ene-diagram/video": src("video"),
  "@ene-diagram/export": src("export"),
  "@ene-diagram/remark": src("remark"),
  "@ene-diagram/element": src("element"),
  "@ene-diagram/react": src("react"),
  "@ene-diagram/vue": src("vue"),
  "@ene-diagram/solid": src("solid"),
};
export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "ene",
          include: ["packages/*/test/**/*.test.ts", "action/test/**/*.test.ts"],
          exclude: ["packages/svelte/**", "packages/angular/**", "**/node_modules/**"],
        },
      },
      {
        extends: true,
        plugins: [svelte()],
        // Svelte's browser build for the DOM test (the server test imports svelte/server explicitly)
        resolve: { conditions: ["browser"] },
        test: { name: "svelte", include: ["packages/svelte/test/**/*.test.ts"] },
      },
      {
        extends: true,
        // Runs against the ng-packagr output (built by the global setup), linked at runtime by @angular/compiler
        test: {
          name: "angular",
          include: ["packages/angular/test/**/*.test.ts"],
          globalSetup: ["packages/angular/test/global-setup.ts"],
        },
      },
    ],
  },
});
