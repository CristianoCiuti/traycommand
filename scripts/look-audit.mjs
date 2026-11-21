// Lists the CSS classes the interface uses that a look does not style (node scripts/look-audit.mjs [look]).
// Every look must style every part of the interface in its own way: nothing may fall back to another look's shapes.
import fs from 'node:fs';
import path from 'node:path';

const UI = 'src/ui';
const LOOKS = ['aurora', 'terminal', 'brutal', 'neon'];
const files = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory() && f.name !== 'themes') walk(p);
    else if (/\.tsx?$/.test(f.name)) files.push(p);
  }
};
walk(UI);
const used = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/class(?:Name)?=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
    const text = (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ');
    for (const c of text.split(/\s+/)) if (/^[a-z][a-z0-9-]*$/i.test(c)) used.add(c);
  }
  // classes written inside expressions: 'on', 'pill on'...
  for (const m of src.matchAll(/class=\{[^}`]*'([a-z0-9 -]+)'/gi)) for (const c of m[1].split(/\s+/)) if (c) used.add(c);
}
const wanted = process.argv[2] ? [process.argv[2]] : LOOKS;
for (const look of wanted) {
  const css = ['styles.css', 'launcher.css', 'tokens.css'].map((f) => fs.readFileSync(path.join(UI, 'themes', look, f), 'utf8')).join('\n');
  const missing = [...used].filter((c) => !new RegExp(`\\.${c}(?![a-z0-9-])`, 'i').test(css)).sort();
  console.log(`${look}: ${missing.length} classes not styled\n  ${missing.join(' ')}`);
}
