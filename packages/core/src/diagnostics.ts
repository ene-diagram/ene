export const CODES = [
  "E101", "E102", "E103", "E104", "E105", "E106", "E107", "E108", "E109", "E110", "E111",
  "E201", "E203", "E204", "E205",
  "E301", "E302", "E303", "E304",
  "E401", "E402", "E403", "E404",
  "W101", "W102", "W103", "W104",
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

/**
 * 가장 가까운 후보 (동률이면 먼저 나온 것).
 * 허용 거리 = clamp(floor(길이/3), 1, 2), 3글자 미만은 제안하지 않음 — 짧은 id 끼리의 오탐 방지
 */
export function suggest(word: string, candidates: Iterable<string>): string | undefined {
  const len = [...word].length;
  if (len < 3) return undefined;
  let best: string | undefined, bestD = Math.min(2, Math.max(1, Math.floor(len / 3))) + 1;
  for (const c of candidates) {
    if (c === word) continue;
    const dd = distance(word, c);
    if (dd < bestD) { best = c; bestD = dd; }
  }
  return best;
}

export const KEYWORDS = ["title", "speed", "wait", "loop", "branch", "else", "end", "pin", "rank", "group"];

export type Lang = "en" | "ko";
interface Msg { message: string; hint: string }

/** 자리표시: {name} {word} {value} {char} {suggestion} {block} {arm} {first} {second} {other} {cell} */
export const MESSAGES: Record<Lang, Record<Code, Msg>> = {
  en: {
    E101: { message: "no steps to play", hint: "write at least one edge, e.g. `user -> api : request`" },
    E102: { message: 'unknown statement "{word}"', hint: "an edge looks like `a -> b : label`; keywords are title, speed, wait, loop, branch, end, pin, rank" },
    E103: { message: "missing target node after the arrow", hint: "add the node the data goes to, e.g. `a -> b`" },
    E104: { message: "missing source node before the arrow", hint: "add the node the data comes from, e.g. `a -> b`" },
    E105: { message: "unclosed `[` in node label", hint: "close the label with `]`, e.g. `api[API server]`" },
    E106: { message: "`&` needs an edge on both sides", hint: "join two edges, e.g. `a -> b & a -> c`" },
    E107: { message: 'character "{char}" is not allowed in a node id', hint: "ids use letters, digits, `_` and `-`; put other text in a label: `id[My Label]`" },
    E108: { message: 'unknown node attribute "{name}"', hint: "only `icon` is supported, e.g. `api{icon: aws:lambda}`" },
    E109: { message: "`{` of node attributes is not closed", hint: "close it with `}`, e.g. `api{icon: aws:lambda}`" },
    E110: { message: 'unknown shape "{value}"', hint: "use one of box, round, db, queue, circle" },
    E111: { message: 'color "{value}" is not valid', hint: "use a color name like `orange` or hex like `#f59e0b`" },
    E201: { message: 'branch arm "{arm}" has no steps', hint: "add at least one edge under this `branch` line" },
    E203: { message: "`{block}` block is never closed", hint: "add `end` after the last step of this block" },
    E204: { message: "`end` without an open block", hint: "remove this line or open a block with `branch` or `loop`" },
    E205: { message: "`else` without an open `branch`", hint: "start the branch with `branch <label>` and add arms with `else <label>`" },
    E301: { message: 'wait time "{value}" is not a number of seconds', hint: "use a non-negative number, e.g. `wait 0.5`" },
    E302: { message: 'loop count "{value}" must be a whole number of 1 or more', hint: "e.g. `loop 3`" },
    E303: { message: 'duration "@{value}" is not valid', hint: "write seconds with an `s`, e.g. `@2s` or `@0.5s`" },
    E304: { message: 'speed "{value}" must be a number above 0', hint: "speed is seconds per step, e.g. `speed 1.2`" },
    E401: { message: 'unknown node "{name}"', hint: "use a node that appears in an edge" },
    E402: { message: 'pin position "{value}" is not valid', hint: "write column,row from 0, e.g. `pin db 3,1`" },
    E403: { message: '"{name}" is pinned to cell {cell}, already taken by "{other}"', hint: "pick a different column,row" },
    E404: { message: '"{name}" cannot join group "{group}"', hint: "a node belongs to one group; a nested group (`in`) can only take members of its parent" },
    W101: { message: 'node "{name}" is used only once and looks like "{suggestion}"', hint: "if it is a typo, rename it; otherwise ignore this warning" },
    W102: { message: 'node "{name}" was labeled "{first}" before, now "{second}"', hint: "the first label is kept; remove one of them" },
    W103: { message: 'edge goes from "{name}" to itself', hint: "self-loops are drawn but usually mean a typo" },
    W104: { message: 'icon "{name}" was not found in the registered icon packs', hint: "register a pack that has it (ene.registerIconPacks / --icons) or use an SVG URL" },
  },
  ko: {
    E101: { message: "재생할 단계가 없어요", hint: "엣지를 하나 이상 써 주세요. 예: `user -> api : 요청`" },
    E102: { message: '"{word}" 을(를) 이해하지 못했어요', hint: "엣지는 `a -> b : 라벨` 형태예요. 키워드: title, speed, wait, loop, branch, end, pin, rank" },
    E103: { message: "화살표 뒤에 대상 노드가 없어요", hint: "데이터가 가는 노드를 써 주세요. 예: `a -> b`" },
    E104: { message: "화살표 앞에 출발 노드가 없어요", hint: "데이터가 나오는 노드를 써 주세요. 예: `a -> b`" },
    E105: { message: "노드 라벨의 `[` 가 닫히지 않았어요", hint: "`]` 로 닫아 주세요. 예: `api[API 서버]`" },
    E106: { message: "`&` 양쪽에 엣지가 있어야 해요", hint: "엣지 두 개를 이어 주세요. 예: `a -> b & a -> c`" },
    E107: { message: '노드 id 에 "{char}" 는 쓸 수 없어요', hint: "id 는 글자·숫자·`_`·`-` 만 돼요. 다른 글자는 라벨에: `id[내 라벨]`" },
    E108: { message: '"{name}" 은(는) 알 수 없는 노드 속성이에요', hint: "지금은 `icon` 만 돼요. 예: `api{icon: aws:lambda}`" },
    E109: { message: "노드 속성의 `{` 가 닫히지 않았어요", hint: "`}` 로 닫아 주세요. 예: `api{icon: aws:lambda}`" },
    E110: { message: '"{value}" 는 알 수 없는 모양이에요', hint: "box, round, db, queue, circle 중에서 골라 주세요" },
    E111: { message: '색 "{value}" 형식이 맞지 않아요', hint: "`orange` 같은 색 이름이나 `#f59e0b` 같은 16진수로 써 주세요" },
    E201: { message: '분기 갈래 "{arm}" 에 단계가 없어요', hint: "이 `branch` 줄 아래에 엣지를 하나 이상 써 주세요" },
    E203: { message: "`{block}` 블록이 닫히지 않았어요", hint: "블록의 마지막 단계 뒤에 `end` 를 써 주세요" },
    E204: { message: "열린 블록 없이 `end` 가 나왔어요", hint: "이 줄을 지우거나 `branch`·`loop` 로 블록을 열어 주세요" },
    E205: { message: "열린 `branch` 없이 `else` 가 나왔어요", hint: "`branch <라벨>` 로 분기를 열고 `else <라벨>` 로 갈래를 더해 주세요" },
    E301: { message: '대기 시간 "{value}" 가 초 단위 숫자가 아니에요', hint: "0 이상 숫자를 써 주세요. 예: `wait 0.5`" },
    E302: { message: '반복 횟수 "{value}" 는 1 이상 정수여야 해요', hint: "예: `loop 3`" },
    E303: { message: '시간 "@{value}" 형식이 맞지 않아요', hint: "초 뒤에 `s` 를 붙여 주세요. 예: `@2s`, `@0.5s`" },
    E304: { message: 'speed "{value}" 는 0 보다 큰 숫자여야 해요', hint: "단계당 초예요. 예: `speed 1.2`" },
    E401: { message: '"{name}" 라는 노드가 없어요', hint: "엣지에 나오는 노드를 써 주세요" },
    E402: { message: 'pin 위치 "{value}" 형식이 맞지 않아요', hint: "0부터 시작하는 열,행으로 써 주세요. 예: `pin db 3,1`" },
    E403: { message: '"{name}" 를 {cell} 칸에 고정하려 했지만 이미 "{other}" 가 있어요', hint: "다른 열,행을 골라 주세요" },
    E404: { message: '"{name}" 는 그룹 "{group}" 에 들어갈 수 없어요', hint: "노드는 그룹 하나에만 속해요. 안쪽 그룹(`in`)은 바깥 그룹의 멤버만 담을 수 있어요" },
    W101: { message: '"{name}" 노드가 한 번만 쓰였고 "{suggestion}" 와 비슷해요', hint: "오타라면 고치고, 아니라면 무시해도 돼요" },
    W102: { message: '"{name}" 노드 라벨이 처음엔 "{first}", 지금은 "{second}" 예요', hint: "처음 라벨을 써요. 하나를 지워 주세요" },
    W103: { message: '"{name}" 에서 자기 자신으로 가는 엣지예요', hint: "그려지긴 하지만 대개 오타예요" },
    W104: { message: '등록된 아이콘 팩에서 "{name}" 아이콘을 찾지 못했어요', hint: "그 아이콘이 있는 팩을 등록하거나(ene.registerIconPacks / --icons) SVG URL 을 써 주세요" },
  },
};

export const DID_YOU_MEAN: Record<Lang, string> = { en: 'did you mean "{suggestion}"?', ko: '혹시 "{suggestion}" 인가요?' };

export const fill = (tpl: string, args: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k) => args[k] ?? "");
