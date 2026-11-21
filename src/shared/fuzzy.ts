/*
 * Fuzzy matching for the launcher: every word of the query must be found, in order of its
 * characters, in the label or in the path ("Docker › Start"). Case and accents are ignored.
 * Contiguous matches, matches at word starts and in the label score higher.
 */

export interface FuzzyMatch {
  score: number;
  /** Matched character positions in the label (for highlighting). */
  label: number[];
}

/** Lower case without diacritics, keeping the same length as the input. */
export function fold(text: string): string {
  let out = '';
  for (const ch of text) {
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const lower = (base.length === ch.length ? base : ch).toLowerCase();
    // positions must not move: keep a character whose lower case would be longer
    /* v8 ignore next */
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

const isBoundary = (text: string, i: number) => i === 0 || /[\s\-_./\\›:()[\]]/.test(text[i - 1]!) || (/[a-z]/.test(text[i - 1]!) && /[A-Z]/.test(text[i]!));

/** Best match of one token in a text: substring first, then subsequence. */
function matchToken(token: string, folded: string, original: string): { score: number; positions: number[] } | undefined {
  const index = folded.indexOf(token);
  if (index >= 0) {
    // prefer an occurrence at a word start
    let best = index;
    for (let i = index; i >= 0; i = folded.indexOf(token, i + 1)) {
      if (isBoundary(original, i)) {
        best = i;
        break;
      }
    }
    const positions = Array.from({ length: token.length }, (_, k) => best + k);
    let score = token.length * 4;
    if (best === 0) score += 12;
    else if (isBoundary(original, best)) score += 8;
    if (token.length === folded.length) score += 6;
    return { score, positions };
  }
  // subsequence: greedy, preferring word starts
  const positions: number[] = [];
  let from = 0;
  let score = 0;
  for (const ch of token) {
    let at = -1;
    for (let i = from; i < folded.length; i++) {
      if (folded[i] !== ch) continue;
      if (at < 0) at = i;
      if (isBoundary(original, i)) {
        at = i;
        break;
      }
      if (positions.length && i === positions.at(-1)! + 1) {
        at = i;
        break;
      }
    }
    if (at < 0) return undefined;
    const prev = positions.at(-1);
    score += prev !== undefined && at === prev + 1 ? 4 : isBoundary(original, at) ? (at === 0 ? 10 : 7) : 1;
    if (prev !== undefined && at - prev > 3) score -= 1;
    positions.push(at);
    from = at + 1;
  }
  return { score, positions };
}

export function fuzzyMatch(query: string, label: string, context = ''): FuzzyMatch | undefined {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return { score: 0, label: [] };
  const fl = fold(label);
  const fc = fold(context);
  let score = 0;
  const highlight = new Set<number>();
  for (const token of tokens) {
    const inLabel = matchToken(token, fl, label);
    const inContext = context ? matchToken(token, fc, context) : undefined;
    if (inLabel && (!inContext || inLabel.score + 4 >= inContext.score)) {
      score += inLabel.score + 4;
      inLabel.positions.forEach((p) => highlight.add(p));
    } else if (inContext) {
      score += inContext.score;
    } else {
      return undefined;
    }
  }
  // shorter labels win among equal matches
  score -= Math.min(label.length, 40) * 0.05;
  return { score, label: [...highlight].sort((a, b) => a - b) };
}
