import { execFileSync } from "node:child_process";

/** The Angular test runs against the ng-packagr output, so build it (and the player types it compiles against) first */
export default function setup() {
  const root = new URL("../../../", import.meta.url).pathname;
  execFileSync("pnpm", ["exec", "tsc", "-b", "packages/player"], { cwd: root, stdio: "inherit" });
  execFileSync("pnpm", ["-C", "packages/angular", "build"], { cwd: root, stdio: "ignore" });
}
