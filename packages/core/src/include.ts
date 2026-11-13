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
  /**
   * The path with every symbolic link resolved (`fs.realpathSync`); throws when it does not exist. The folder
   * check is made on these paths, so a link inside the folder cannot lead out of it
   */
  realPath(absolute: string): string;
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
  const lexicalRoot = path.resolve(io.rootDir);
  const max = io.maxLength ?? INCLUDE_MAX_BYTES;
  const outside = (root: string, file: string) => {
    const rel = path.relative(root, file);
    return rel === "" || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || path.isAbsolute(rel);
  };
  const failed = (e: unknown) => ({ error: (e as { code?: string }).code ?? "cannot read the file" });
  return (target, from) => {
    if (path.isAbsolute(target)) return { error: "absolute paths are not allowed" };
    const base = from !== undefined && path.isAbsolute(from) ? path.dirname(from) : lexicalRoot;
    const asWritten = path.resolve(base, target);
    if (outside(lexicalRoot, asWritten)) return { error: "the file is outside the diagram's folder" };
    // Again on the real paths: a symbolic link inside the folder must not lead out of it
    let file: string, root: string;
    try {
      root = io.realPath(lexicalRoot);
      file = io.realPath(asWritten);
    } catch (e) {
      return failed(e);
    }
    if (outside(root, file)) return { error: "the file is outside the diagram's folder" };
    let source: string;
    try {
      source = io.readFile(file);
    } catch (e) {
      return failed(e);
    }
    if (source.length > max) return { error: "the file is too large" };
    return { source, file };
  };
}
