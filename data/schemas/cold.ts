import { z } from 'zod';

/**
 * On the ice and in the cold (plan 11 §3.2, §18.4 piece M; plan 04 §8.2; `cold.json`): what
 * ice holds a man, how thin ice gives way, how the cold wears your warmth down and what
 * gives it back, the hand sled, tracks in the snow and the Bayfield–La Pointe ice road.
 * Rates are per real second on foot unless named otherwise.
 */
const pos = z.number().positive();
const nonneg = z.number().nonnegative();
const share = z.number().min(0).max(1);

export const coldFileSchema = z.object({
  ice: z.object({
    /** The ice's top above the lake, m. */
    topM: pos,
    /** Ice is there to stand on only where it covers this much of the water... */
    minCoverage: share,
    /** ...and is at least this thick, cm: thinner is slush you fall straight through. */
    formsCm: pos,
    /** Ice this thick holds a man walking, cm; thinner works toward breaking. */
    holdCm: pos,
    /** A sled's load needs a centimeter more for each this many kilograms. */
    kgPerCm: pos,
    /** Weak spots (springs, currents, a pressure crack): their size, m, and how much thinner. */
    weakSpotM: pos,
    weakSpotDepth: z.number().min(0).max(0.9),
    /** The ice road's marked lane has no weak spots within this many meters of it. */
    roadClearM: pos,
  }),
  thin: z.object({
    /** Stress a second for each whole shortfall of thickness (1 = no ice at all). */
    rate: pos,
    runMul: pos,
    stillMul: nonneg,
    /** Stress shed a second off thin ice. */
    relax: pos,
    /** The stages: a crack underfoot, then the groan, then (at 1) it goes. */
    crackAt: share,
    groanAt: share,
    /** The hole's radius, m. */
    holeM: pos,
    /** Seconds of hauling to get out over the edge, and the cold's window to do it in. */
    climbS: pos,
    windowS: pos,
    /** The edge holds you at least this often, more on thicker ice. */
    edgeHoldMin: share,
  }),
  warmth: z.object({
    /** Dressed for it, air warmer than this costs nothing, °C (wind chill counted). */
    comfortC: z.number(),
    /** Warmth lost a second for each degree colder than comfort. */
    lossPerDegreeS: pos,
    /** Wet through, the loss is this many times more. */
    wetMul: pos,
    /** In the water: warmth a second for each degree under 16 °C. */
    waterLossPerDegreeS: pos,
    /** Back a second in air that costs nothing, and at a fire, stove or hearth. */
    recoverS: pos,
    heatS: pos,
    /** A fire warms you this close, m. */
    heatRadiusM: pos,
    /** Wet dried a second by a fire, and in air above freezing. */
    dryHeatS: pos,
    dryAirS: pos,
    /** Wet a second at full rain, and at full snow. */
    rainWetS: pos,
    snowWetS: pos,
    /** Running loses this share of the cold's toll. */
    runWarmMul: pos,
    /** The warnings: chilled, cold, freezing (0–100). */
    chilled: pos,
    cold: pos,
    freezing: pos,
    /** At no warmth left, health lost a second. */
    drainHealthS: pos,
    /** Aboard, warmth back a game hour by the galley stove. */
    aboardPerHour: pos,
  }),
  sled: z.object({
    capacityCu: z.number().int().positive(),
    /** A CU weighs this much on the sled, times the good's weight factor, kg. */
    cuKg: pos,
    sledKg: pos,
    /** The tow rope, m. */
    ropeM: pos,
    /** Walking speed lost for each weighted CU, down to the floor. */
    slowPerCu: nonneg,
    minSpeedMul: pos,
  }),
  tracks: z.object({
    /** A print every this many meters walked. */
    spacingM: pos,
    max: z.number().int().positive(),
    /** Game seconds a print lasts, and game seconds of steady snow that fill it. */
    lifeS: pos,
    fillS: pos,
    /** A guard notices a print this close, if it's this fresh (game seconds). */
    noticeM: pos,
    freshS: pos,
    /** He follows the trail this many prints on. */
    leadPrints: z.number().int().positive(),
  }),
  road: z.object({
    id: z.string(),
    name: z.string(),
    /** The piers the road runs between (harbors.json ids). */
    from: z.string(),
    to: z.string(),
    /** The port at its near end (the papers' and the harbor card's). */
    fromPort: z.string(),
    /** The port at its far end, whose trading post buys the sled's load. */
    toPort: z.string(),
    /** The ice along the road is this thick or more: it's open. */
    openCm: pos,
    /** Evergreen boughs mark it every this many meters. */
    markerM: pos,
    /** Within this of a road's end, you're there, m. */
    endM: pos,
  }),
});
export type ColdFile = z.infer<typeof coldFileSchema>;
