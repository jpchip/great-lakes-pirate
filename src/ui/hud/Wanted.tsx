import type { ReportSnapshot, WantedSnapshot } from '../port/harbor-model';

/**
 * The Wanted marks (plan 13 §4.1, §12; plan 06 §3.2; Phase 5 piece E). Each tier has its
 * own shape, never color alone: Clean is an empty ring, tiers 1–4 a shield with that many
 * pips, and Most Wanted the noose, which looks like nothing else on the HUD.
 */

/** A pip on the shield: a small diamond. */
function pip(cx: number, cy: number) {
  return (
    <path
      key={`${cx},${cy}`}
      d={`M${cx} ${cy - 2.2}L${cx + 1.6} ${cy}L${cx} ${cy + 2.2}L${cx - 1.6} ${cy}Z`}
    />
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[8, 8]],
  2: [
    [6, 8],
    [10, 8],
  ],
  3: [
    [5, 7],
    [8, 10],
    [11, 7],
  ],
  4: [
    [5.5, 6.5],
    [10.5, 6.5],
    [5.5, 10.5],
    [10.5, 10.5],
  ],
};

export function WantedIcon({ tier, top }: { tier: number; top: boolean }) {
  if (top) {
    // The noose: a loop of rope hanging from a crossbeam, with the knot's coils.
    return (
      <svg class="wanted-icon noose" viewBox="0 0 16 16" aria-hidden="true" data-tier={tier}>
        <path d="M2 1.5H14" class="wanted-rope" />
        <path d="M8 1.5V6" class="wanted-rope" />
        <path d="M6.6 6h2.8M6.6 7.4h2.8M6.6 8.8h2.8" class="wanted-rope thin" />
        <ellipse cx="8" cy="12" rx="3.2" ry="3" class="wanted-rope" />
      </svg>
    );
  }
  if (tier <= 0) {
    return (
      <svg class="wanted-icon clean" viewBox="0 0 16 16" aria-hidden="true" data-tier={0}>
        <circle cx="8" cy="8" r="5" class="wanted-ring" />
      </svg>
    );
  }
  return (
    <svg class="wanted-icon" viewBox="0 0 16 16" aria-hidden="true" data-tier={tier}>
      <path
        d="M8 1.2L14 3.4V8.2C14 11.4 11.4 13.8 8 15C4.6 13.8 2 11.4 2 8.2V3.4Z"
        class="wanted-shield"
      />
      <g class="wanted-pips">{(PIPS[Math.min(4, tier)] ?? []).map(([x, y]) => pip(x, y))}</g>
    </svg>
  );
}

/** The HUD's regional indicator: the mark, the tier and where. */
export function WantedChip({ wanted }: { wanted: WantedSnapshot }) {
  const words = wanted.top
    ? `Most Wanted in ${wanted.regionName}: capture means the rope`
    : `${wanted.tierName} in ${wanted.regionName}`;
  return (
    <div
      class={`hud-chip hud-wanted tier-${wanted.tier}${wanted.top ? ' danger top' : ''}`}
      data-testid="hud-wanted"
      data-tier={wanted.tier}
      role={wanted.top ? 'alert' : 'status'}
      aria-label={words}
    >
      <WantedIcon tier={wanted.tier} top={wanted.top} />
      {words}
    </div>
  );
}

/** The report eye (plan 06 §2.4): who's carrying word of you, and how long until it lands. */
export function ReportChip({ report }: { report: ReportSnapshot }) {
  return (
    <div
      class={`hud-chip hud-report${report.vague ? ' vague' : ''}`}
      data-testid="hud-report"
      role="status"
      title={
        report.vague
          ? 'They only saw "someone": it will put the law on guard, but not on your name'
          : `Word of you reaches ${report.regionName} when it lands`
      }
    >
      <svg class="hud-eye-icon" viewBox="0 0 16 10" aria-hidden="true">
        <path d="M1 5C4 0.5 12 0.5 15 5C12 9.5 4 9.5 1 5Z" class="eye-lid" />
        <circle cx="8" cy="5" r="2.3" class="eye-pupil" />
      </svg>
      <span>
        Report: {report.by} to {report.regionName}
      </span>
      <span class="hud-num hud-report-timer" data-testid="hud-report-timer">
        {report.etaText}
      </span>
      {report.more > 0 && <span class="hud-dim">+{report.more}</span>}
    </div>
  );
}
