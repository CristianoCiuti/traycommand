/*
 * File name patterns for folder watches: "*.txt", "report-??.csv", "*.{jpg,png}", "[ab]*",
 * "**" for any number of sub folders ("in/**\/*.txt"). A pattern without "/" matches the file
 * name in any folder; with "/" it matches the path relative to the watched folder.
 */

export function globToRegExp(pattern: string, ignoreCase = true): RegExp {
  const p = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  let out = '';
  let braces = 0;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]!;
    if (ch === '*') {
      if (p[i + 1] === '*') {
        i++;
        if (p[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else out += '.*';
      } else out += '[^/]*';
    } else if (ch === '?') out += '[^/]';
    else if (ch === '{') {
      braces++;
      out += '(?:';
    } else if (ch === '}' && braces > 0) {
      braces--;
      out += ')';
    } else if (ch === ',' && braces > 0) out += '|';
    else if (ch === '[') {
      const end = p.indexOf(']', i + 2);
      if (end < 0) throw new Error(`Unclosed "[" in ${pattern}`);
      let body = p.slice(i + 1, end);
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      out += `[${body.replace(/\\/g, '\\\\')}]`;
      i = end;
    } else out += ch.replace(/[.+^$()|\\]/g, '\\$&');
  }
  if (braces) throw new Error(`Unclosed "{" in ${pattern}`);
  return new RegExp(`^${out}$`, ignoreCase ? 'i' : '');
}

export function globError(pattern: string): string | undefined {
  if (!pattern.trim()) return 'Empty pattern';
  try {
    globToRegExp(pattern);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

/** Patterns as written in the configuration: one string, comma separated, or a list. */
export function patternList(files: string | string[] | undefined): string[] {
  const list = files === undefined ? [] : Array.isArray(files) ? files : splitPatterns(files);
  return list.map((p) => p.trim()).filter(Boolean);
}

/** Splits "a.txt, *.{jpg,png}" on the commas outside braces. */
export function splitPatterns(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '{') depth++;
    if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Matcher for a path relative to the watched folder (any separator). No patterns = every file. */
export function fileMatcher(patterns: string[], ignoreCase = true): (relative: string) => boolean {
  const compiled = patterns.map((p) => ({ re: globToRegExp(p, ignoreCase), byName: !p.replace(/\\/g, '/').includes('/') }));
  return (relative) => {
    if (!compiled.length) return true;
    const rel = relative.replace(/\\/g, '/');
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    return compiled.some((c) => c.re.test(c.byName ? name : rel));
  };
}
