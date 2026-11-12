import type { Document, Edge, Stmt, Timeline, TimelineStep } from "./types.js";

export interface TimelineOptions {
  /** choices[i] = 소스 등장 순서 i번째 branch 에서 고를 갈래 (기본 0, 범위 밖이면 0) */
  choices?: number[];
}

export function buildTimeline(doc: Document, opts: TimelineOptions = {}): Timeline {
  const allEdges: Edge[] = [];
  const edgeIndex = new Map<Edge, number>();
  const branchIndex = new Map<Stmt, number>();
  const branches: Timeline["branches"] = [];

  // 1차: 모든 갈래·loop 를 포함해 고유 엣지와 분기 번호를 소스 순서로 모은다
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

  // 2차: 선택된 경로를 따라 시각을 계산한다
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
