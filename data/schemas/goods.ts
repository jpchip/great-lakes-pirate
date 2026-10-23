import { z } from 'zod';
import { idOf } from './common';

export const goodSchema = z.object({
  id: idOf('good'),
  name: z.string().min(1),
  category: z.enum(['legit', 'contraband']),
  /** Money is integer cents (plan 01 §8). */
  basePriceCents: z.number().int().nonnegative(),
  weightKg: z.number().positive(),
  volumeM3: z.number().positive(),
  seasons: z.array(z.enum(['spring', 'summer', 'fall', 'winter'])).min(1),
});

export const goodsFileSchema = z.array(goodSchema);
export type Good = z.infer<typeof goodSchema>;
