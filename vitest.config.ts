import { defineConfig } from "vitest/config";
const src = (p: string) => new URL(`./packages/${p}/src/index.ts`, import.meta.url).pathname;
export default defineConfig({
  resolve: { alias: { "@ene-diagram/core": src("core"), "@ene-diagram/layout": src("layout"), "@ene-diagram/svg": src("svg"), "@ene-diagram/player": src("player"), "@ene-diagram/video": src("video") } },
  test: { include: ["packages/*/test/**/*.test.ts", "action/test/**/*.test.ts"], globals: true },
});
