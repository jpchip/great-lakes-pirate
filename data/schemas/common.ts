import { z } from 'zod';

/** Stable string IDs like "good.whitefish" (plan 01 §8). */
export const idOf = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}\\.[a-z0-9_]+$`), `Expected an id like "${prefix}.name"`);
