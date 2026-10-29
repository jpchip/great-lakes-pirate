import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../../src/core/time';
import {
  barometerSkill,
  monthStats,
  runSeason,
  trendOutlook,
  type MonthStats,
  type ProbeSeries,
} from '../../src/debug/weather-sim/season';
import { CLIMATE_MONTHS } from '../../src/sim/weather/climate';
import { createWeatherState, weatherTick } from '../../src/sim/weather/weather';

/**
 * Spike S9 report (plan 04 §20): run the weather over the MVP season for several seeds
 * and print how it scores. `npm run bench:weather` writes last-run.txt and .json here.
 */

const SEEDS = Array.from({ length: Number(process.env.S9_SEEDS ?? 16) }, (_, i) => `s9-${i + 1}`);
/** May 7 to early December: the whole MVP season (plan 04 §15). */
const DAYS = 30;
const MAIN_PROBE = 'bayfield';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const f1 = (x: number) => x.toFixed(1);

function correlation(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] as number;
    mb += b[i] as number;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] as number) - ma;
    const db = (b[i] as number) - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return sab / Math.sqrt(saa * sbb);
}

test('S9 weather season report', () => {
  const lines: string[] = [];
  const json: Record<string, unknown> = {};
  const months = new Map<string, MonthStats[]>();
  /** Thick-fog days over every probe: [fog days, days]. */
  const allFog = new Map<string, [number, number]>();
  const mainProbes: ProbeSeries[] = [];
  const skills: ReturnType<typeof barometerSkill>[][] = [];
  let tickMs = 0;
  let ticks = 0;

  lines.push(`S9 weather sim, ${SEEDS.length} seeds × ${DAYS} game days (May 7 → early Dec)`);
  for (const seed of SEEDS) {
    const run = runSeason(seed, DAYS);
    tickMs += run.tickMs;
    ticks += run.ticks;
    const lows = run.systems.filter((s) => s.kind === 'low');
    const byTrack = (t: string) => lows.filter((s) => s.track === t).length;
    const probe = run.probes.find((p) => p.id === MAIN_PROBE) as ProbeSeries;
    const duluth = run.probes.find((p) => p.id === 'duluth') as ProbeSeries;
    mainProbes.push(probe);
    const stats = monthStats(run, probe);
    for (const m of stats) months.set(m.month, [...(months.get(m.month) ?? []), m]);
    for (const p of run.probes) {
      for (const m of monthStats(run, p)) {
        const [f, d] = allFog.get(m.month) ?? [0, 0];
        allFog.set(m.month, [f + m.thickFogDays, d + m.days]);
      }
    }
    const skill = [-1, -2, -3].map((th) => barometerSkill(probe, th));
    skills.push(skill);
    const fog = (k: string) => run.fogBanks.filter((f) => f.kind === k).length;
    lines.push(
      `${seed}: ${lows.length} lows (${lows.filter((s) => s.peakHpa <= -20).length} deep; ` +
        `${byTrack('clipper')} clipper, ${byTrack('panhandle')} panhandle, ${byTrack('pacific')} pacific), ` +
        `${run.systems.length - lows.length} highs, fog banks ${fog('advection')} advection + ${fog('radiation')} radiation; ` +
        `wind r(Bayfield, Duluth) = ${correlation(probe.windKn, duluth.windKn).toFixed(2)}`,
    );
    json[seed] = {
      systems: run.systems.length,
      lows: lows.length,
      fogBanks: run.fogBanks.length,
      months: stats,
      skill,
    };
  }

  lines.push(`\nBayfield by calendar month, mean over seeds (Dec is only the first few days)`);
  lines.push(
    'month  mean kn  p90  max  ≥28kn  ≥34kn  gales/seed  min hPa  <1km   <400m  thick-fog days  (all probes)',
  );
  for (const [month, list] of months) {
    const avg = (f: (m: MonthStats) => number) => list.reduce((s, m) => s + f(m), 0) / list.length;
    const fogDays = list.reduce((s, m) => s + m.thickFogDays, 0);
    const days = list.reduce((s, m) => s + m.days, 0);
    lines.push(
      `${month.padEnd(5)} ${f1(avg((m) => m.meanWindKn)).padStart(8)} ${avg((m) => m.p90WindKn)
        .toFixed(0)
        .padStart(4)} ` +
        `${Math.max(...list.map((m) => m.maxWindKn))
          .toFixed(0)
          .padStart(4)} ${pct(avg((m) => m.strongShare)).padStart(6)} ` +
        `${pct(avg((m) => m.galeShare)).padStart(6)} ${f1(avg((m) => m.galeOnsets)).padStart(11)} ` +
        `${Math.min(...list.map((m) => m.minHpa))
          .toFixed(0)
          .padStart(8)} ${pct(avg((m) => m.fogShare)).padStart(6)} ` +
        `${pct(avg((m) => m.thickFogShare)).padStart(6)}  ${`${fogDays}/${days} (${pct(fogDays / days)})`.padEnd(14)}` +
        `  ${pct((allFog.get(month)?.[0] ?? 0) / (allFog.get(month)?.[1] ?? 1))}`,
    );
  }

  // The NOAA check (plan 04 §23): the sim at Bayfield beside hourly Devils Island wind.
  lines.push(`\nSim (Bayfield) vs observed (Devils Island, NDBC DISW3 2012–2023)`);
  lines.push(
    'month  mean kn sim/obs  p90 sim/obs  ≥28kn sim/obs   ≥34kn sim/obs   resultant sim / obs',
  );
  const fromOf = (v: { x: number; y: number }) =>
    ((Math.atan2(-v.x, -v.y) * 180) / Math.PI + 360) % 360;
  const observed: Record<string, unknown> = {};
  for (const [month, list] of months) {
    const obs = CLIMATE_MONTHS.find((m) => m.id === `climate.${month.toLowerCase()}`)?.observed;
    if (!obs) continue;
    const avg = (f: (m: MonthStats) => number) => list.reduce((s, m) => s + f(m), 0) / list.length;
    const res = { x: avg((m) => m.resultantToKn.x), y: avg((m) => m.resultantToKn.y) };
    const row = {
      meanKn: avg((m) => m.meanWindKn),
      p90Kn: avg((m) => m.p90WindKn),
      over28Pct: avg((m) => m.strongShare) * 100,
      over34Pct: avg((m) => m.galeShare) * 100,
      resultantKn: Math.hypot(res.x, res.y),
      resultantFromDeg: fromOf(res),
    };
    observed[month] = { sim: row, observed: obs };
    lines.push(
      `${month.padEnd(5)} ${`${f1(row.meanKn)} / ${f1(obs.meanWindKn)}`.padStart(15)} ` +
        `${`${f1(row.p90Kn)} / ${f1(obs.p90WindKn)}`.padStart(12)} ` +
        `${`${f1(row.over28Pct)}% / ${f1(obs.over28KnPct)}%`.padStart(15)} ` +
        `${`${f1(row.over34Pct)}% / ${f1(obs.over34KnPct)}%`.padStart(15)}   ` +
        `${f1(row.resultantKn)} kn from ${row.resultantFromDeg.toFixed(0)}° / ` +
        `${f1(obs.resultantKn)} kn from ${obs.resultantFromDeg}°`,
    );
  }
  json.observed = observed;

  lines.push(`\nWind direction share at Bayfield (from), by month`);
  for (const [month, list] of months) {
    const sectors = Object.keys(list[0]?.sectors ?? {}) as (keyof MonthStats['sectors'])[];
    lines.push(
      `${month.padEnd(5)} ` +
        sectors
          .map((s) =>
            `${s} ${Math.round((list.reduce((a, m) => a + m.sectors[s], 0) / list.length) * 100)}`.padEnd(
              7,
            ),
          )
          .join(' '),
    );
  }

  lines.push(`\nBarometer as a storm warning at Bayfield (storm = ≥ 28 kn after 3 h below it)`);
  for (let k = 0; k < 3; k++) {
    const s = skills.map((x) => x[k] as ReturnType<typeof barometerSkill>);
    const sum = (f: (v: (typeof s)[number]) => number) => s.reduce((a, v) => a + f(v), 0);
    const leads = s
      .map((v) => v.medianLeadHours)
      .filter((v) => !Number.isNaN(v))
      .sort((a, b) => a - b);
    lines.push(
      `fall ≤ ${s[0]?.thresholdHpa} hPa/3h: warned ${sum((v) => v.warned)}/${sum((v) => v.storms)} storms ` +
        `(median of seed lead times ${f1(leads[Math.floor(leads.length / 2)] ?? NaN)} h); ` +
        `${sum((v) => v.warningsFollowed)}/${sum((v) => v.warnings)} warnings followed by a storm within 18 h`,
    );
  }

  lines.push(`\nWhat each barometer reading is followed by at Bayfield (next 12 game hours)`);
  lines.push('reading        share of time  mean max wind  storm (≥28 kn) chance');
  const outlook = trendOutlook(mainProbes, 12);
  for (const o of outlook) {
    lines.push(
      `${o.trend.padEnd(14)} ${pct(o.share).padStart(13)} ${f1(o.meanMaxWindKn).padStart(11)} kn ${pct(o.stormShare).padStart(12)}`,
    );
  }
  json.outlook = outlook;

  // Batch fast-forward: a 12-week jail sentence is 12 game days (plan 01 §3.3).
  const state = createWeatherState('s9-ff');
  const ffTicks = (12 * SECONDS_PER_GAME_DAY) / WORLD_TICK_GAME_SECONDS;
  const start = performance.now();
  for (let i = 1; i <= ffTicks; i++) weatherTick(state, i * WORLD_TICK_GAME_SECONDS);
  const ffMs = performance.now() - start;
  lines.push(
    `\nCost: ${f1((tickMs / ticks) * 1000)} µs per world tick on average; ` +
      `fast-forward of 12 game days (${ffTicks} ticks) ${f1(ffMs)} ms`,
  );
  json.cost = {
    usPerTick: (tickMs / ticks) * 1000,
    fastForwardTicks: ffTicks,
    fastForwardMs: ffMs,
  };

  const text = lines.join('\n');
  console.log(text);
  writeFileSync(join(import.meta.dirname, 'last-run.txt'), text + '\n');
  writeFileSync(join(import.meta.dirname, 'last-run.json'), JSON.stringify(json, null, 1) + '\n');
});
