import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataFileSchemas } from '../data/schemas';
import { islandsFileSchema } from '../data/schemas/islands';
import { portsFileSchema } from '../data/schemas/ports';
import { sitesFileSchema } from '../data/schemas/sites';
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

  it('links every set piece to a port or a hideout site, and every site to its set piece', () => {
    const sites = sitesFileSchema.parse(read('sites.json'));
    const siteIds = new Set(sites.map((s) => s.id));
    for (const zone of zones) {
      for (const piece of zone.setPieces) {
        if (piece.site) expect(siteIds, piece.id).toContain(piece.site);
        else expect(portIds, piece.id).toContain(piece.port);
      }
    }
    for (const site of sites) {
      const piece = zones.flatMap((z) => z.setPieces).find((p) => p.id === site.setPiece);
      expect(piece?.site, site.id).toBe(site.id);
      expect(zones.find((z) => z.setPieces.includes(piece!))?.id, site.id).toBe(site.zone);
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
