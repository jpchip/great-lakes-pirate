import type { z } from 'zod';
import { chartFileSchema } from './chart';
import { goodsFileSchema } from './goods';
import { islandsFileSchema } from './islands';
import { portsFileSchema } from './ports';
import { shipsFileSchema } from './ships';
import { zonesFileSchema } from './zones';

/** Every data/*.json file and the schema that validates it. */
export const dataFileSchemas: Readonly<Record<string, z.ZodType>> = {
  'chart.json': chartFileSchema,
  'goods.json': goodsFileSchema,
  'islands.json': islandsFileSchema,
  'ports.json': portsFileSchema,
  'ships.json': shipsFileSchema,
  'zones.json': zonesFileSchema,
};
