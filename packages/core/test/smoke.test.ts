import { readFileSync } from "node:fs";
import { VERSION } from "../src/index";
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
test("VERSION matches package.json", () => expect(VERSION).toBe(pkg.version));
