import type { Document, Edge, Stmt, Timeline, TimelineStep } from "./types.js";

export interface TimelineOptions {
  /** choices[i] = arm to pick at the i-th branch in source order (default 0; 0 if out of range) */
  choices?: number[];
}

/** Fraction of an async step's duration after which the next step starts */
export const ASYNC_HANDOFF = 0.25;

export function buildTimeline(doc: Document, opts: TimelineOptions = {}): Timeline {
  const allEdges: Edge[] = [];
  const edgeIndex = new Map<Edge, number>();
  const branchIndex = new Map<Stmt, number>();
  const branches: Timeline["branches"] = [];

  // Pass 1: collect unique edges and branch numbers in source order, including all arms and loops
  const collect = (body: Stmt[]) => {
    for (const s of body) {
      if (s.type === "step")
        for (const e of s.edges) {
          edgeIndex.set(e, allEdges.length);
          allEdges.push(e);
        }
      else if (s.type === "loop") collect(s.body);
      else if (s.type === "branch") {
        branchIndex.set(s, branches.length);
        branches.push({ label: "", arms: s.arms.map((a) => a.label), ...(s.optional ? { optional: true } : {}) });
        s.arms.forEach((a) => {
          collect(a.body);
        });
      }
    }
  };
  collect(doc.body);

  // Pass 2: compute times along the chosen path
  const steps: TimelineStep[] = [];
  let t = 0,
    end = 0;
  const walk = (body: Stmt[], path: number[]) => {
    for (const s of body) {
      if (s.type === "wait") t += s.seconds;
      else if (s.type === "loop") for (let i = 0; i < s.count; i++) walk(s.body, path);
      else if (s.type === "branch") {
        const bi = branchIndex.get(s)!;
        const want = opts.choices?.[bi] ?? 0;
        const ai = want >= 0 && want < s.arms.length ? want : 0;
        walk(s.arms[ai].body, [...path, bi, ai]);
      } else {
        const durs = s.edges.map((e) => e.duration ?? doc.speed);
        const duration = Math.max(...durs);
        steps.push({
          index: steps.length,
          start: t,
          duration,
          branchPath: path,
          ...(s.note !== undefined ? { note: s.note } : {}),
          edges: s.edges.map((e, i) => ({
            edgeIndex: edgeIndex.get(e)!,
            from: e.from,
            to: e.to,
            kind: e.kind,
            label: e.label,
            start: t,
            duration: durs[i],
          })),
        });
        // A step of only async edges (`~>`) does not block: the next step starts after a short hand-off
        t += s.edges.every((e) => e.kind === "async") ? duration * ASYNC_HANDOFF : duration;
        end = Math.max(end, t, steps[steps.length - 1].start + duration);
      }
    }
  };
  walk(doc.body, []);
  return { steps, total: Math.max(t, end), branches, allEdges };
}

/** One way through the document: the arm picked at each branch, and the labels of the branches it passes */
export interface PathChoice {
  /** choices[i] = arm of the i-th branch in source order (0 for branches this path never reaches) */
  choices: number[];
  /** Arm labels of the branches this path passes, in order (`opt`: its label, or `skip <label>`) */
  labels: string[];
}

/** Most paths `enumeratePaths` returns */
export const MAX_PATHS = 16;

/**
 * Every distinct path through the document's `branch` / `opt` blocks, in source order (first arms first).
 * Branches inside an arm that is not taken do not multiply the result. Returns `undefined` when there are
 * more than `limit` paths.
 */
export function enumeratePaths(doc: Document, limit = MAX_PATHS): PathChoice[] | undefined {
  // Same numbering as buildTimeline: branches in source order, arms included
  const branchIndex = new Map<Stmt, number>();
  const number = (body: Stmt[]) => {
    for (const s of body) {
      if (s.type === "loop") number(s.body);
      else if (s.type === "branch") {
        branchIndex.set(s, branchIndex.size);
        for (const a of s.arms) number(a.body);
      }
    }
  };
  number(doc.body);

  type Partial = { picked: Map<number, number>; labels: string[] };
  let over = false;
  const expand = (body: Stmt[], from: Partial[]): Partial[] => {
    let paths = from;
    for (const s of body) {
      if (over) return paths;
      if (s.type === "loop") paths = expand(s.body, paths);
      else if (s.type === "branch") {
        const bi = branchIndex.get(s)!;
        const next: Partial[] = [];
        for (const p of paths)
          for (const [ai, arm] of s.arms.entries()) {
            const label = s.optional
              ? ai === 0
                ? arm.label || "opt"
                : `skip ${s.arms[0].label}`.trim()
              : arm.label || `#${ai + 1}`;
            next.push(...expand(arm.body, [{ picked: new Map(p.picked).set(bi, ai), labels: [...p.labels, label] }]));
            if (next.length > limit) over = true;
            if (over) return next;
          }
        paths = next;
      }
    }
    return paths;
  };
  const paths = expand(doc.body, [{ picked: new Map(), labels: [] }]);
  if (over || paths.length > limit) return undefined;
  return paths.map((p) => ({
    choices: Array.from({ length: branchIndex.size }, (_, i) => p.picked.get(i) ?? 0),
    labels: p.labels,
  }));
}
