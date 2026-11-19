import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';

describe('published JSON Schema', () => {
  execFileSync(process.execPath, ['scripts/schema.mts']);
  const schema = JSON.parse(fs.readFileSync('site/public/schema/v2/config.schema.json', 'utf8'));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);

  it('accepts the example configuration', () => {
    const ok = validate(JSON.parse(fs.readFileSync('test/e2e/fixtures/config.json', 'utf8')));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('rejects unknown properties in nested menus', () => {
    const ok = validate({ version: 2, trays: [{ id: 'a', label: 'A', menu: [{ label: 'x', menu: [{ label: 'y', wrong: 1 }] }] }] });
    expect(ok).toBe(false);
  });
});
