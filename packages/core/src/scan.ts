export interface Line {
  /** 원본 줄 번호 (1부터) */
  no: number;
  /** 들여쓰기·주석·후행 공백을 뗀 본문 */
  text: string;
  /** 앞 공백(스페이스·탭) 개수 */
  indent: number;
  /** cols[i] = text 의 i번째 코드 포인트가 원본에서 있던 열 (1부터) */
  cols: number[];
}

const isSpace = (c: string) => c === " " || c === "\t";

export function scan(source: string): Line[] {
  const out: Line[] = [];
  source.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const chars = [...raw];
    let start = 0;
    while (start < chars.length && isSpace(chars[start])) start++;
    // 주석: 줄 맨 앞(들여쓰기 뒤) 또는 공백 바로 뒤의 '#'
    let end = chars.length;
    for (let j = start; j < chars.length; j++) {
      if (chars[j] === "#" && (j === start || isSpace(chars[j - 1]))) { end = j; break; }
    }
    while (end > start && isSpace(chars[end - 1])) end--;
    if (end <= start) return;
    const body = chars.slice(start, end);
    out.push({ no: i + 1, text: body.join(""), indent: start, cols: body.map((_, k) => start + k + 1) });
  });
  return out;
}
