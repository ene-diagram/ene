export interface Line {
  /** Original line number (1-based) */
  no: number;
  /** Body with indentation, comment and trailing whitespace stripped */
  text: string;
  /** Number of leading whitespace chars (spaces/tabs) */
  indent: number;
  /** cols[i] = column (1-based) in the original of the i-th code point of text */
  cols: number[];
}

const isSpace = (c: string) => c === " " || c === "\t";

export function scan(source: string): Line[] {
  const out: Line[] = [];
  source
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\r|\n/)
    .forEach((raw, i) => {
      const chars = [...raw];
      let start = 0;
      while (start < chars.length && isSpace(chars[start])) start++;
      // Comment: a '#' at line start (after indentation) or right after whitespace.
      // But a '#' inside a label (inside `[...]`, after the first `:`, after `title`) is a literal character.
      let end = chars.length;
      const isTitle = /^(title|note)[ \t]/.test(chars.slice(start, start + 6).join(""));
      let depth = 0,
        inLabel = false;
      for (let j = start; j < chars.length && !(isTitle && j > start); j++) {
        const c = chars[j];
        if (c === "[" || c === "{") depth++;
        else if ((c === "]" || c === "}") && depth > 0) depth--;
        else if (c === ":" && depth === 0) inLabel = true;
        else if (c === "#" && depth === 0 && !inLabel && (j === start || isSpace(chars[j - 1]))) {
          end = j;
          break;
        }
      }
      while (end > start && isSpace(chars[end - 1])) end--;
      if (end <= start) return;
      const body = chars.slice(start, end);
      out.push({ no: i + 1, text: body.join(""), indent: start, cols: body.map((_, k) => start + k + 1) });
    });
  return out;
}
