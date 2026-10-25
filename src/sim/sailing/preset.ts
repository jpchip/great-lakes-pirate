import { z } from 'zod';
import { sailShipSchema, type SailShipRecord } from '../../../data/schemas/ships';
import { handlingSchema, type HandlingRecord } from './handling';

/**
 * A tuning preset (plan 02 §14.8): one ship record and the handling rules, in data
 * units, so a tuned ship can be pasted straight back into `data/ships.json`.
 */
export const tuningPresetSchema = z.object({
  kind: z.literal('sailing-tuning'),
  version: z.literal(1),
  ship: sailShipSchema,
  handling: handlingSchema,
});

export type TuningPreset = z.infer<typeof tuningPresetSchema>;

export function serializePreset(ship: SailShipRecord, handling: HandlingRecord): string {
  const preset: TuningPreset = { kind: 'sailing-tuning', version: 1, ship, handling };
  return JSON.stringify(preset, null, 2);
}

/** Parses and validates a preset; throws a readable error if it doesn't match. */
export function parsePreset(json: string): TuningPreset {
  const result = tuningPresetSchema.safeParse(JSON.parse(json));
  if (!result.success)
    throw new Error(`Not a sailing tuning preset: ${z.prettifyError(result.error)}`);
  return result.data;
}
