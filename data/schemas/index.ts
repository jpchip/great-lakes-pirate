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
import {
  crimesFileSchema,
  fameTiersFileSchema,
  lawActorsFileSchema,
  regionsFileSchema,
  wantedTiersFileSchema,
} from './law';
import { jailFileSchema } from './jail';
import { lighthousesFileSchema } from './lighthouses';
import { marketsFileSchema } from './markets';
import { newspapersFileSchema } from './newspapers';
import { portsFileSchema } from './ports';
import { routesFileSchema } from './routes';
import { rumorsFileSchema } from './rumors';
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
  'crimes.json': crimesFileSchema,
  'factions.json': factionsFileSchema,
  'fame_tiers.json': fameTiersFileSchema,
  'flows.json': flowsFileSchema,
  'goods.json': goodsFileSchema,
  'harbors.json': harborsFileSchema,
  'islands.json': islandsFileSchema,
  'jail.json': jailFileSchema,
  'law_actors.json': lawActorsFileSchema,
  'lighthouses.json': lighthousesFileSchema,
  'markets.json': marketsFileSchema,
  'newspapers.json': newspapersFileSchema,
  'portraits.json': portraitsFileSchema,
  'ports.json': portsFileSchema,
  'regions.json': regionsFileSchema,
  'routes.json': routesFileSchema,
  'rumors.json': rumorsFileSchema,
  'ships.json': shipsFileSchema,
  'sites.json': sitesFileSchema,
  'smuggler.json': smugglersFileSchema,
  'stores.json': storesFileSchema,
  'upgrades.json': upgradesFileSchema,
  'wanted_tiers.json': wantedTiersFileSchema,
  'zones.json': zonesFileSchema,
};
