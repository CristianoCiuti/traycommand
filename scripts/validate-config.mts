// node scripts/validate-config.mts <file>  — validates a 2.x configuration file
import fs from 'node:fs';
import { parseConfig } from '../src/shared/config.ts';

const file = process.argv[2]!;
const result = parseConfig(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')));
if (result.ok) {
  console.log(`OK: ${result.config.trays.length} trays`);
  for (const w of result.warnings) console.log(`warning ${w.path}: ${w.message}`);
} else {
  for (const i of result.issues) console.log(`ERROR ${i.path}: ${i.message}`);
  process.exit(1);
}
