import type { Document, Edge, Stmt, Timeline, TimelineStep } from "./types.js";

export interface TimelineOptions {
  /** choices[i] = arm to pick at the i-th branch in source order (default 0; 0 if out of range) */
  choices?: number[];
}

export function buildTimeline(doc: Document, opts: TimelineOptions = {}): Timeline {
  const allEdges: Edge[] = [];
  const edgeIndex = new Map<Edge, number>();
  const branchIndex = new Map<Stmt, number>();
  const branches: Timeline["branches"] = [];

  // Pass 1: collect unique edges and branch numbers in source order, including all arms and loops
  const collect = (body: Stmt[]) => {
    for (const s of body) {
      if (s.type === "step") for (const e of s.edges) { edgeIndex.set(e, allEdges.length); allEdges.push(e); }
      else if (s.type === "loop") collect(s.body);
      else if (s.type === "branch") {
        branchIndex.set(s, branches.length);
        branches.push({ label: "", arms: s.arms.map((a) => a.label) });
        s.arms.forEach((a) => collect(a.body));
      }
    }
  };
  collect(doc.body);

  // Pass 2: compute times along the chosen path
  const steps: TimelineStep[] = [];
  let t = 0;
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
          edges: s.edges.map((e, i) => ({
            edgeIndex: edgeIndex.get(e)!, from: e.from, to: e.to, kind: e.kind, label: e.label, start: t, duration: durs[i],
          })),
        });
        t += duration;
      }
    }
  };
  walk(doc.body, []);
  return { steps, total: t, branches, allEdges };
}
