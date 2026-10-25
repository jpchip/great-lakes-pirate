import type { z } from 'zod';
import { chartFileSchema } from './chart';
import { goodsFileSchema } from './goods';
import { portsFileSchema } from './ports';

/** Every data/*.json file and the schema that validates it. */
export const dataFileSchemas: Readonly<Record<string, z.ZodType>> = {
  'chart.json': chartFileSchema,
  'goods.json': goodsFileSchema,
  'ports.json': portsFileSchema,
};
