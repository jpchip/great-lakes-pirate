import type { z } from 'zod';
import { chartFileSchema } from './chart';
import { climateFileSchema } from './climate';
import { factionsFileSchema } from './factions';
import { flowsFileSchema } from './flows';
import { goodsFileSchema } from './goods';
import { harborsFileSchema } from './harbors';
import { islandsFileSchema } from './islands';
import { lighthousesFileSchema } from './lighthouses';
import { marketsFileSchema } from './markets';
import { portsFileSchema } from './ports';
import { routesFileSchema } from './routes';
import { shipsFileSchema } from './ships';
import { sitesFileSchema } from './sites';
import { storesFileSchema } from './stores';
import { zonesFileSchema } from './zones';

/** Every data/*.json file and the schema that validates it. */
export const dataFileSchemas: Readonly<Record<string, z.ZodType>> = {
  'chart.json': chartFileSchema,
  'chart-coast.json': chartFileSchema,
  'climate.json': climateFileSchema,
  'factions.json': factionsFileSchema,
  'flows.json': flowsFileSchema,
  'goods.json': goodsFileSchema,
  'harbors.json': harborsFileSchema,
  'islands.json': islandsFileSchema,
  'lighthouses.json': lighthousesFileSchema,
  'markets.json': marketsFileSchema,
  'ports.json': portsFileSchema,
  'routes.json': routesFileSchema,
  'ships.json': shipsFileSchema,
  'sites.json': sitesFileSchema,
  'stores.json': storesFileSchema,
  'zones.json': zonesFileSchema,
};
