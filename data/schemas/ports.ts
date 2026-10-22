import { z } from 'zod';
import { idOf } from './common';

export const portSchema = z.object({
  id: idOf('port'),
  name: z.string().min(1),
  zone: idOf('zone'),
  wantedRegion: idOf('region'),
  services: z.array(z.enum(['market', 'shipyard', 'fence', 'tavern', 'jail'])),
});

export const portsFileSchema = z.array(portSchema);
export type Port = z.infer<typeof portSchema>;
