import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataFileSchemas } from '../data/schemas';
import { islandsFileSchema } from '../data/schemas/islands';
import { portsFileSchema } from '../data/schemas/ports';
import { zonesFileSchema } from '../data/schemas/zones';

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
    // A settings file (rumors.json) is one object; the rest are lists of definitions.
    if (!Array.isArray(parsed)) return;
    const ids = (parsed as { id: string }[]).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('data cross-references', () => {
  const read = (file: string): unknown =>
    JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as unknown;
  const zones = zonesFileSchema.parse(read('zones.json'));
  const zoneIds = new Set(zones.map((z) => z.id));
  const portIds = new Set(portsFileSchema.parse(read('ports.json')).map((p) => p.id));

  it('puts every port and island in a known zone', () => {
    for (const port of portsFileSchema.parse(read('ports.json'))) {
      expect(zoneIds, port.id).toContain(port.zone);
    }
    for (const island of islandsFileSchema.parse(read('islands.json'))) {
      expect(zoneIds, island.id).toContain(island.zone);
    }
  });

  it('links every set piece to a port', () => {
    for (const zone of zones) {
      for (const piece of zone.setPieces) expect(portIds, piece.id).toContain(piece.port);
    }
  });

  it('gives the Apostles all 22 islands, with the two hand edits', () => {
    const islands = islandsFileSchema
      .parse(read('islands.json'))
      .filter((i) => i.zone === 'zone.apostles');
    expect(islands).toHaveLength(22);
    expect(islands.filter((i) => i.clip).map((i) => i.id)).toEqual(['island.long']);
    expect(islands.filter((i) => i.rock).map((i) => i.id)).toEqual(['island.gull']);
  });
});
