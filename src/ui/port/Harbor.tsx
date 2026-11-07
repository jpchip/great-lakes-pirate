import { formatCents } from '../../sim/economy/knowledge';
import { WantedIcon } from '../hud/Wanted';
import type { HarborSnapshot, PosterSnapshot } from './harbor-model';
import type { PortActions } from './PortScreen';

/**
 * The harbor master's tab (plan 06 §3.3, §5.2; plan 13 §12; Phase 5 piece E): where you
 * stand in the port's region, the fine or bribe he'll take for it, and the WANTED poster
 * on his board once you're on one.
 */

/** A WANTED bill, printed on cheap paper and pinned up (plan 06 §3.2 tier 2+). */
export function Poster({ poster }: { poster: PosterSnapshot }) {
  return (
    <figure
      class={`wanted-poster tier-${poster.tier}`}
      data-testid="wanted-poster"
      aria-label={`${poster.headline}: ${poster.subject}`}
    >
      <div class="poster-headline">{poster.headline}</div>
      <div class="poster-subject">{poster.subject}</div>
      <div class="poster-detail">{poster.detail}</div>
      <div class="poster-charge">{poster.charge}</div>
      {poster.rewardText && <div class="poster-reward">{poster.rewardText}</div>}
      <figcaption class="poster-foot">
        Apply to the harbor master or any officer of the law
      </figcaption>
    </figure>
  );
}

function HeatBar({ h }: { h: HarborSnapshot }) {
  const span = h.tierTo !== undefined ? h.tierTo - h.tierFrom : 0;
  const frac = span > 0 ? Math.min(1, (h.heat - h.tierFrom) / span) : 1;
  return (
    <div
      class="harbor-heat"
      title={
        h.tierTo !== undefined
          ? `${h.heat} heat: ${h.tierTo - h.heat} more and you're a tier worse`
          : `${h.heat} heat`
      }
    >
      <div class="port-capacity-bar" aria-hidden="true">
        <div style={{ width: `${(frac * 100).toFixed(1)}%` }} />
      </div>
    </div>
  );
}

export function Harbor({
  harbor: h,
  actions,
  setMessage,
}: {
  harbor: HarborSnapshot;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  const q = h.quote;
  return (
    <div class="port-harbor" data-testid="harbor">
      <div class="harbor-main">
        <div class={`harbor-standing tier-${h.tier}`} data-testid="harbor-standing">
          <WantedIcon tier={h.tier} top={h.tier >= 5} />
          <div>
            <strong>{h.tierName}</strong> <span class="port-dim">in {h.regionName}</span>
            {h.tier > 0 && <HeatBar h={h} />}
          </div>
        </div>
        {q ? (
          <div class="harbor-deal" data-testid="harbor-deal">
            <p class="menu-note">
              {q.kind === 'fine'
                ? 'He opens the book at your page. A fine, paid in cash, and the matter is closed.'
                : "He doesn't open the book. He looks at the window, and says these things can be forgotten, for a consideration."}{' '}
              {q.effect}
              {h.saloonKeeper && (
                <span class="port-dim"> You know how it's done: he asks a quarter less.</span>
              )}
            </p>
            <button
              type="button"
              class="menu-button primary"
              data-testid={`harbor-${q.kind}`}
              disabled={!q.affordable}
              onClick={() => setMessage(actions.payHarbor?.(q.kind))}
            >
              {q.label} ({formatCents(q.cents)})
            </button>
          </div>
        ) : (
          <p class="menu-note" data-testid="harbor-refusal">
            {h.refusalText}
          </p>
        )}
        <ul class="harbor-notes">
          {h.reportsComing > 0 && (
            <li data-testid="harbor-reports">
              Word is on its way to him: {h.reportsComing} report
              {h.reportsComing === 1 ? '' : 's'} not yet in. Paying now won't cover it.
            </li>
          )}
          {h.holdChecked && (
            <li>His men go through the hold of every wanted ship that docks here.</li>
          )}
          {h.informRisk && (
            <li>The quiet trade is watched here: {h.informRisk} a receiver turns you in.</li>
          )}
        </ul>
      </div>
      {h.poster && <Poster poster={h.poster} />}
    </div>
  );
}
