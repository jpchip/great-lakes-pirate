import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataFileSchemas } from '../data/schemas';

const dataDir = join(import.meta.dirname, '..', 'data');
const jsonFiles = readdirSync(dataDir).filter((f) => f.endsWith('.json'));

describe('data definitions', () => {
  it('has a schema for every data file', () => {
    for (const file of jsonFiles) expect(dataFileSchemas, file).toHaveProperty([file]);
  });

  it.each(jsonFiles)('%s matches its schema and has unique ids', (file) => {
    const schema = dataFileSchemas[file];
    if (!schema) throw new Error(`No schema for ${file}`);
    const parsed = schema.parse(JSON.parse(readFileSync(join(dataDir, file), 'utf8')));
    const ids = (parsed as { id: string }[]).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
