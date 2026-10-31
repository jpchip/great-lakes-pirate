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
