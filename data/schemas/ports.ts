import { z } from 'zod';
import { idOf } from './common';

/**
 * What a port offers at its piers (plan 05 §7). The port screen (Phase 4 piece B) shows a
 * tab for each service that's built: the market, the chandlery and the freight agent
 * (piece F), then the shipyard and saloon as their pieces land.
 */
export const PORT_SERVICES = [
  'market',
  'chandlery',
  'freight',
  'shipyard',
  'fence',
  'tavern',
  'jail',
] as const;

export const portSchema = z.object({
  id: idOf('port'),
  name: z.string().min(1),
  zone: idOf('zone'),
  wantedRegion: idOf('region'),
  services: z.array(z.enum(PORT_SERVICES)),
  /**
   * A trade-only port (plan 05 §4.2, R1 §5): its merchant buys and sells honest goods and
   * nothing else. No hot goods or contraband can be offered there, so no crime is possible.
   */
  tradeOnly: z.boolean().default(false),
});

export const portsFileSchema = z.array(portSchema);
export type Port = z.infer<typeof portSchema>;
export type PortService = Port['services'][number];
