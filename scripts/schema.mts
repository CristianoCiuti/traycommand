// Generates the public JSON Schema of the configuration from the zod definitions.
import fs from 'node:fs';
import { z } from 'zod';
import { ConfigSchema } from '../src/shared/config.ts';

const schema = z.toJSONSchema(ConfigSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
schema.$id = 'https://cristianociuti.github.io/traycommand/schema/v2/config.schema.json';
schema.title = 'TrayCommand configuration (v2)';
const out = 'site/public/schema/v2';
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(`${out}/config.schema.json`, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`schema written to ${out}/config.schema.json`);
