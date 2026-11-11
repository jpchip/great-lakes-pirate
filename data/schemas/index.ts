import type { z } from 'zod';
import { backgroundsFileSchema, portraitsFileSchema } from './backgrounds';
import { boardingRulesSchema } from './boarding';
import { chartFileSchema } from './chart';
import { climateFileSchema } from './climate';
import { ammoFileSchema, weaponsFileSchema } from './combat';
import { contractsFileSchema } from './contracts';
import { districtsFileSchema, kitFileSchema } from './districts';
import { factionsFileSchema } from './factions';
import { fencesFileSchema } from './fences';
import { gunsFileSchema } from './guns';
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
import { npcTypesFileSchema } from './npc_types';
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
  'ammo.json': ammoFileSchema,
  'backgrounds.json': backgroundsFileSchema,
  'boarding.json': boardingRulesSchema,
  'chart.json': chartFileSchema,
  'chart-coast.json': chartFileSchema,
  'climate.json': climateFileSchema,
  'contracts.json': contractsFileSchema,
  'crimes.json': crimesFileSchema,
  'districts.json': districtsFileSchema,
  'factions.json': factionsFileSchema,
  'fame_tiers.json': fameTiersFileSchema,
  'flows.json': flowsFileSchema,
  'goods.json': goodsFileSchema,
  'harbors.json': harborsFileSchema,
  'islands.json': islandsFileSchema,
  'jail.json': jailFileSchema,
  'kit.json': kitFileSchema,
  'law_actors.json': lawActorsFileSchema,
  'lighthouses.json': lighthousesFileSchema,
  'markets.json': marketsFileSchema,
  'newspapers.json': newspapersFileSchema,
  'npc_types.json': npcTypesFileSchema,
  'portraits.json': portraitsFileSchema,
  'ports.json': portsFileSchema,
  'regions.json': regionsFileSchema,
  'routes.json': routesFileSchema,
  'rumors.json': rumorsFileSchema,
  'ships.json': shipsFileSchema,
  'sites.json': sitesFileSchema,
  'smuggler.json': smugglersFileSchema,
  'fences.json': fencesFileSchema,
  'guns.json': gunsFileSchema,
  'stores.json': storesFileSchema,
  'upgrades.json': upgradesFileSchema,
  'wanted_tiers.json': wantedTiersFileSchema,
  'weapons.json': weaponsFileSchema,
  'zones.json': zonesFileSchema,
};
