import type { z } from 'zod';
import { chartFileSchema } from './chart';
import { climateFileSchema } from './climate';
import { goodsFileSchema } from './goods';
import { islandsFileSchema } from './islands';
import { lighthousesFileSchema } from './lighthouses';
import { portsFileSchema } from './ports';
import { shipsFileSchema } from './ships';
import { zonesFileSchema } from './zones';

/** Every data/*.json file and the schema that validates it. */
export const dataFileSchemas: Readonly<Record<string, z.ZodType>> = {
  'chart.json': chartFileSchema,
  'climate.json': climateFileSchema,
  'goods.json': goodsFileSchema,
  'islands.json': islandsFileSchema,
  'lighthouses.json': lighthousesFileSchema,
  'ports.json': portsFileSchema,
  'ships.json': shipsFileSchema,
  'zones.json': zonesFileSchema,
};
