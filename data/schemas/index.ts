import type { z } from 'zod';
import { ambitionsFileSchema } from './ambitions';
import { backgroundsFileSchema, portraitsFileSchema } from './backgrounds';
import { boardingRulesSchema } from './boarding';
import { chartFileSchema } from './chart';
import { climateFileSchema } from './climate';
import { ammoFileSchema, weaponsFileSchema } from './combat';
import { contractsFileSchema } from './contracts';
import { itemsFileSchema, recipesFileSchema, stationsFileSchema } from './crafting';
import { districtsFileSchema, kitFileSchema } from './districts';
import { eventsFileSchema } from './events';
import { factionsFileSchema } from './factions';
import { fencesFileSchema } from './fences';
import { pokerFileSchema } from './poker';
import { gunsFileSchema } from './guns';
import { flowsFileSchema } from './flows';
import { goodsFileSchema } from './goods';
import { harborsFileSchema } from './harbors';
import { locksFileSchema, lootTablesFileSchema } from './heist';
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
import { lightStationsFileSchema } from './light_stations';
import { marketsFileSchema } from './markets';
import { newspapersFileSchema } from './newspapers';
import { npcTypesFileSchema } from './npc_types';
import { poisFileSchema } from './pois';
import { portsFileSchema } from './ports';
import { routesFileSchema } from './routes';
import { rumorsFileSchema } from './rumors';
import { shipsFileSchema } from './ships';
import { sitesFileSchema } from './sites';
import { smugglersFileSchema } from './smuggler';
import { storesFileSchema } from './stores';
import { startersFileSchema, structuresFileSchema } from './structures';
import { toolsFileSchema } from './tools';
import { upgradesFileSchema } from './upgrades';
import { zonesFileSchema } from './zones';

/** Every data/*.json file and the schema that validates it. */
export const dataFileSchemas: Readonly<Record<string, z.ZodType>> = {
  'ambitions.json': ambitionsFileSchema,
  'ammo.json': ammoFileSchema,
  'backgrounds.json': backgroundsFileSchema,
  'boarding.json': boardingRulesSchema,
  'chart.json': chartFileSchema,
  'chart-coast.json': chartFileSchema,
  'climate.json': climateFileSchema,
  'contracts.json': contractsFileSchema,
  'crimes.json': crimesFileSchema,
  'districts.json': districtsFileSchema,
  'events.json': eventsFileSchema,
  'factions.json': factionsFileSchema,
  'fame_tiers.json': fameTiersFileSchema,
  'flows.json': flowsFileSchema,
  'goods.json': goodsFileSchema,
  'harbors.json': harborsFileSchema,
  'islands.json': islandsFileSchema,
  'items.json': itemsFileSchema,
  'jail.json': jailFileSchema,
  'kit.json': kitFileSchema,
  'law_actors.json': lawActorsFileSchema,
  'lighthouses.json': lighthousesFileSchema,
  'light_stations.json': lightStationsFileSchema,
  'locks.json': locksFileSchema,
  'loot_tables.json': lootTablesFileSchema,
  'markets.json': marketsFileSchema,
  'newspapers.json': newspapersFileSchema,
  'npc_types.json': npcTypesFileSchema,
  'pois.json': poisFileSchema,
  'poker.json': pokerFileSchema,
  'portraits.json': portraitsFileSchema,
  'ports.json': portsFileSchema,
  'recipes.json': recipesFileSchema,
  'regions.json': regionsFileSchema,
  'routes.json': routesFileSchema,
  'rumors.json': rumorsFileSchema,
  'ships.json': shipsFileSchema,
  'sites.json': sitesFileSchema,
  'smuggler.json': smugglersFileSchema,
  'fences.json': fencesFileSchema,
  'guns.json': gunsFileSchema,
  'starters.json': startersFileSchema,
  'stations.json': stationsFileSchema,
  'stores.json': storesFileSchema,
  'structures.json': structuresFileSchema,
  'tools.json': toolsFileSchema,
  'upgrades.json': upgradesFileSchema,
  'wanted_tiers.json': wantedTiersFileSchema,
  'weapons.json': weaponsFileSchema,
  'zones.json': zonesFileSchema,
};
