import { describe, expect, it } from 'vitest';
import { captureLine, hailForecast, type CaptureTakes } from '../src/ui/hud/hail-forecast';
import type { CaptureOutcome } from '../src/sim/law/jail';

const week: CaptureOutcome = {
  kind: 'jail',
  tier: 1,
  heat: 50,
  sentenceWeeks: 1,
  bailCents: 3400,
  impoundCents: 2000,
};
const wanted: CaptureOutcome = { ...week, tier: 2, sentenceWeeks: 2, bailCents: 6000 };
const clean: CaptureTakes = { cargoCU: 0, wholeHold: false, cashCents: 0, purseCents: 279649 };

describe('the hail forecast: heave to or run', () => {
  it('tells a clean hold she lets you go, and what capture would cost', () => {
    const f = hailForecast({
      by: 'npc.cutter',
      name: 'The Morrill',
      intent: 'inspect',
      arrest: false,
      tierName: 'Suspicious',
      lots: [],
      captureNow: week,
      takes: clean,
      arrestOnFind: 'none',
    });
    expect(f.title).toContain('Heave to for inspection');
    expect(f.standing).toBe("You're Suspicious here.");
    expect(f.heaveTo.lines[0]).toMatch(/lets you go/);
    expect(f.run.lines.join(' ')).toMatch(/Jail, 1 week \(bail \$34\.00/);
    expect(f.run.lines.join(' ')).toMatch(/nothing she would take/);
    expect(f.run.lines.join(' ')).toMatch(/surrender/);
  });

  it('names each lot she might find, the odds as words, and the arrest a find brings', () => {
    const f = hailForecast({
      by: 'npc.cutter',
      name: 'The Morrill',
      intent: 'inspect',
      arrest: false,
      tierName: 'Suspicious',
      lots: [{ name: 'Brownstone', qty: 4, kind: 'hot', chance: 0.5 }],
      captureNow: week,
      takes: { ...clean, cargoCU: 4 },
      arrestOnFind: 'any',
      captureAfterFind: wanted,
      takesAfterFind: { ...clean, cashCents: 139825 },
    });
    expect(f.heaveTo.lines[0]).toBe('4 CU Brownstone, stolen: risky');
    expect(f.heaveTo.lines[1]).toMatch(/makes you Wanted/);
    expect(f.heaveTo.lines[2]).toMatch(/2 weeks.*\$1,398 of the \$2,796 on hand/);
  });

  it('a pursuit hail: heaving to is the surrender', () => {
    const f = hailForecast({
      by: 'npc.cutter',
      name: 'The Morrill',
      intent: 'pursue',
      arrest: false,
      tierName: 'Hunted',
      lots: [],
      captureNow: { ...week, tier: 3, sentenceWeeks: 5 },
      takes: { cargoCU: 30, wholeHold: true, cashCents: 279649, purseCents: 279649 },
      arrestOnFind: 'none',
    });
    expect(f.heaveTo.head).toBe('Heave to: you surrender');
    expect(f.heaveTo.lines[0]).toMatch(/all 30 CU of your cargo and the \$2,796 on hand/);
  });

  it('says the rope at the top tier', () => {
    expect(captureLine({ kind: 'execution', tier: 5, heat: 600 }, clean)).toMatch(/rope/);
  });
});
