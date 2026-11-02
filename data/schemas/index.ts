import type { z } from 'zod';
import { backgroundsFileSchema, portraitsFileSchema } from './backgrounds';
import { chartFileSchema } from './chart';
import { climateFileSchema } from './climate';
import { contractsFileSchema } from './contracts';
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
import { smugglersFileSchema } from './smuggler';
import { storesFileSchema } from './stores';
import { upgradesFileSchema } from './upgrades';
import { zonesFileSchema } from './zones';

/** Every data/*.json file and the schema that validates it. */
export const dataFileSchemas: Readonly<Record<string, z.ZodType>> = {
  'backgrounds.json': backgroundsFileSchema,
  'chart.json': chartFileSchema,
  'chart-coast.json': chartFileSchema,
  'climate.json': climateFileSchema,
  'contracts.json': contractsFileSchema,
  'factions.json': factionsFileSchema,
  'flows.json': flowsFileSchema,
  'goods.json': goodsFileSchema,
  'harbors.json': harborsFileSchema,
  'islands.json': islandsFileSchema,
  'lighthouses.json': lighthousesFileSchema,
  'markets.json': marketsFileSchema,
  'portraits.json': portraitsFileSchema,
  'ports.json': portsFileSchema,
  'routes.json': routesFileSchema,
  'ships.json': shipsFileSchema,
  'sites.json': sitesFileSchema,
  'smuggler.json': smugglersFileSchema,
  'stores.json': storesFileSchema,
  'upgrades.json': upgradesFileSchema,
  'zones.json': zonesFileSchema,
};
