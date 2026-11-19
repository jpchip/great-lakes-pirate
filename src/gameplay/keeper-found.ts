import type { GameContext } from '../modes/context';
import { regionAtGeo } from '../sim/law/regions';
import { bodyFound, emptyStation, lightDef, logSighting, stationFor } from '../sim/light-stations';
import { log } from '../sim/run/record';
import type { GameLaw } from './law';

/**
 * The keepers' log and a keeper nobody's left to find (plan 06 §6.2, plan 11 §10). Every
 * ship a station's keepers see from the tower goes in their log, yours among them. Kill the
 * last keeper at a station and nobody tells it: he's found a week or two on, and the law
 * hears of a killing then. If the log has your ship (or you, a visitor by day) at the
 * station shortly before, and the book's still in the house, it's tied to you that far;
 * take the logbook and it's a killing by persons unknown.
 */

export interface KeeperFound {
  /** Runs the finding now (the world tick does; the dev hook after jumping the clock). */
  step(): number;
  dispose(): void;
}

export function attachKeeperFound(deps: {
  ctx: GameContext;
  law: GameLaw;
  notice?: (text: string) => void;
}): KeeperFound {
  const { ctx, law } = deps;
  const now = (): number => ctx.state.environment.clock.gameSeconds;

  // The tower's log: a keeper's sighting of your ship at sea.
  const logged = ({
    witness: w,
  }: {
    witness: { id: string; kind: string; identification: string };
  }) => {
    if (w.kind !== 'keeper' || !stationFor(w.id)) return;
    const ident = w.identification;
    if (ident !== 'unknown' && ident !== 'schooner' && ident !== 'ship' && ident !== 'person')
      return;
    logSighting(((ctx.state.lightStations ??= {})[w.id] ??= emptyStation()), now(), ident);
  };
  const offSpotted = ctx.events.on('PlayerSpotted', logged);
  const offIdentified = ctx.events.on('PlayerIdentified', logged);

  const step = (): number => {
    const t = now();
    let found = 0;
    for (const [lightId, st] of Object.entries(ctx.state.lightStations ?? {})) {
      const f = bodyFound(st, t);
      if (!f) continue;
      found++;
      const def = lightDef(lightId);
      const short = def?.name.replace(/ Light$/, '') ?? 'the light';
      const region = def ? regionAtGeo(law.defs, def.at) : 'region.apostles';
      law.commit({
        crime: 'crime.killing',
        region,
        witnesses: [
          {
            id: `tender.${lightId}`,
            kind: 'crew',
            name: 'the lighthouse tender',
            identification: f.ident,
          },
        ],
        details: { victim: `the ${short} keeper`, killed: f.killed },
      });
      const tied = f.ident !== 'unknown';
      log(
        ctx.state,
        t,
        tied
          ? `The ${short} keeper was found dead. His log has you there before it.`
          : `The ${short} keeper was found dead. Nothing ties it to you.`,
      );
      deps.notice?.(
        tied
          ? `The ${short} keeper has been found. His log puts you there.`
          : `The ${short} keeper has been found dead. Nobody knows who did it.`,
      );
    }
    return found;
  };
  const offTick = ctx.events.on('WorldTick', () => {
    step();
  });

  return {
    step,
    dispose() {
      offSpotted();
      offIdentified();
      offTick();
    },
  };
}
