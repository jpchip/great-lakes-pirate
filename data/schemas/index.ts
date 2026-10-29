import type { z } from 'zod';
import { chartFileSchema } from './chart';
import { climateFileSchema } from './climate';
import { goodsFileSchema } from './goods';
import { portsFileSchema } from './ports';
import { shipsFileSchema } from './ships';

/** Every data/*.json file and the schema that validates it. */
export const dataFileSchemas: Readonly<Record<string, z.ZodType>> = {
  'chart.json': chartFileSchema,
  'climate.json': climateFileSchema,
  'goods.json': goodsFileSchema,
  'ports.json': portsFileSchema,
  'ships.json': shipsFileSchema,
};
