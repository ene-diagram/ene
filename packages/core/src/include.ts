import type { Includer } from "./parse.js";

/** What `createIncluder` needs from the host. Pass `node:path` and a `readFileSync` wrapper; core imports neither */
export interface IncluderIo {
  /** Folder the root source is in. Included files must stay inside it */
  rootDir: string;
  path: {
    resolve(...parts: string[]): string;
    dirname(p: string): string;
    relative(from: string, to: string): string;
    isAbsolute(p: string): boolean;
  };
  /** Text of the file at this absolute path; throws when it cannot be read */
  readFile(absolute: string): string;
  /** Largest file to include, in UTF-16 code units of text (default INCLUDE_MAX_BYTES) */
  maxLength?: number;
}

export const INCLUDE_MAX_BYTES = 512 * 1024;

/**
 * An `Includer` over a file system. Paths are relative to the file that has the `include` line (the root
 * source is taken to be in `rootDir`). Absolute paths and anything that leaves `rootDir` are refused, so a
 * diagram from someone else cannot pull in files from outside its own folder.
 */
export function createIncluder(io: IncluderIo): Includer {
  const { path } = io;
  const root = path.resolve(io.rootDir);
  const max = io.maxLength ?? INCLUDE_MAX_BYTES;
  return (target, from) => {
    if (path.isAbsolute(target)) return { error: "absolute paths are not allowed" };
    const base = from !== undefined && path.isAbsolute(from) ? path.dirname(from) : root;
    const file = path.resolve(base, target);
    const rel = path.relative(root, file);
    if (rel === "" || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || path.isAbsolute(rel))
      return { error: "the file is outside the diagram's folder" };
    let source: string;
    try {
      source = io.readFile(file);
    } catch (e) {
      return { error: (e as { code?: string }).code ?? "cannot read the file" };
    }
    if (source.length > max) return { error: "the file is too large" };
    return { source, file };
  };
}
