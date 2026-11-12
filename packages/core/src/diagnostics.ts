export const CODES = [
  "E101", "E102", "E103", "E104", "E105", "E106", "E107",
  "E201", "E203", "E204",
  "E301", "E302", "E303", "E304",
  "E401", "E402", "E403",
  "W101", "W102", "W103",
] as const;
export type Code = (typeof CODES)[number];

/** 제한 Damerau-Levenshtein(OSA) 거리 */
export function distance(a: string, b: string): number {
  const s = [...a], t = [...b];
  const d: number[][] = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 1; j <= t.length; j++) d[0][j] = j;
  for (let i = 1; i <= s.length; i++)
    for (let j = 1; j <= t.length; j++) {
      const c = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[s.length][t.length];
}

/** 거리 2 이하 중 가장 가까운 후보 (동률이면 먼저 나온 것) */
export function suggest(word: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined, bestD = 3;
  for (const c of candidates) {
    if (c === word) continue;
    const dd = distance(word, c);
    if (dd < bestD) { best = c; bestD = dd; }
  }
  return best;
}
