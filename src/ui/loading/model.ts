import type { ArenaEncounter } from '../../sim/arena/encounter';

/**
 * The loading screen between places (plan 03 §7, plan 13 §4): a fade to fog with a
 * logbook line, shown while a zone loads. Plain data, so the text can be tested.
 */
export interface LoadingScreen {
  /** The place being made for, e.g. "Apostle Islands". */
  title: string;
  /** A logbook line under it. */
  line: string;
}

/** How the ship comes into the zone. */
export type Arrival = { kind: 'entry'; entryName: string } | { kind: 'return' };

export function loadingScreen(zoneName: string, arrival: Arrival): LoadingScreen {
  switch (arrival.kind) {
    case 'entry': {
      // "North of Bear Island, from the open lake" → "Out of the fog, north of Bear Island."
      const where = arrival.entryName.replace(/,.*$/, '');
      const lower = where.charAt(0).toLowerCase() + where.slice(1);
      return { title: zoneName, line: `Out of the fog, ${lower}.` };
    }
    case 'return':
      return { title: zoneName, line: 'Coming about for the islands again.' };
  }
}

/** The fade into an open-water arena (Phase 3 piece G): what the lookout saw. */
export function arenaLoadingScreen(enc: ArenaEncounter): LoadingScreen {
  const title = 'Open water';
  if (enc.forced) return { title, line: 'She has seen you. No running from this one.' };
  const first = enc.ships[0];
  switch (enc.kind) {
    case 'squall':
      return { title, line: 'A squall line, black to windward. Shorten sail.' };
    case 'fogbank':
      return { title, line: 'Fog on the water ahead, rolling down on the wind.' };
    case 'derelict':
      return { title, line: `A hulk on the swell: ${first?.name ?? 'a wreck'}.` };
    case 'cutter':
      return { title, line: `Smoke on the horizon: the ${first?.name ?? 'cutter'}.` };
    case 'ship':
      return {
        title,
        line:
          enc.ships.length > 1
            ? `Smoke and sails ahead: ${first?.name ?? 'a ship'} and consorts.`
            : `Closing the ${first?.name ?? 'stranger'}.`,
      };
  }
}
