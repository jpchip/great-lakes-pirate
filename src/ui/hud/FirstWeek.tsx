import type { FirstWeekSnapshot } from '../../gameplay/captain';

/**
 * The Captain's First Week (plan 12 §3, plan 13 §5; Phase 4 piece C): a journal page
 * with every step, and a small tracker on the HUD with the next one. The tracker can be
 * put away; the journal keeps the list and can bring it back. When every step is done the
 * list folds to one checked mark that can be cleared from the ledger.
 */

export function FirstWeekTracker({
  week,
  setHidden,
}: {
  week: FirstWeekSnapshot;
  setHidden(hidden: boolean): void;
}) {
  const done = week.lines.filter((l) => l.done).length;
  const next = week.lines.find((l) => !l.done);
  return (
    <aside class="first-week-tracker" data-testid="first-week-tracker">
      <div class="first-week-head">
        <span class="hud-label first-week-kicker">First week</span>
        <span class="hud-num" data-testid="first-week-count">
          {done}/{week.lines.length}
        </span>
        <button
          type="button"
          class="first-week-close"
          title="Put the checklist away (it stays in the journal)"
          data-testid="first-week-hide"
          onClick={() => setHidden(true)}
        >
          ×
        </button>
      </div>
      {next ? (
        <>
          <div class="first-week-next" data-testid="first-week-next">
            {next.number}. {next.text}
          </div>
          <div class="hud-dim">{next.hint}</div>
        </>
      ) : (
        <div class="first-week-next">Your first week is done. The lake is yours.</div>
      )}
    </aside>
  );
}

export function FirstWeekPage({
  week,
  setHidden,
  clearFromLedger,
}: {
  week: FirstWeekSnapshot;
  setHidden(hidden: boolean): void;
  clearFromLedger(): void;
}) {
  if (week.complete) {
    return (
      <section class="first-week-page first-week-done" data-testid="first-week-page">
        <div class="first-week-mark" data-testid="first-week-mark">
          <span class="first-week-box" aria-hidden="true">
            ✓
          </span>
          <span>The Captain&apos;s First Week</span>
        </div>
        <button
          type="button"
          class="menu-button"
          data-testid="first-week-clear"
          onClick={() => clearFromLedger()}
        >
          Clear from the ledger
        </button>
      </section>
    );
  }

  return (
    <section class="first-week-page" data-testid="first-week-page">
      <h3 class="create-heading">The Captain's First Week</h3>
      <ol class="first-week-list">
        {week.lines.map((l) => (
          <li key={l.step} class={l.done ? 'done' : ''} data-testid={`first-week-${l.step}`}>
            <span class="first-week-box" aria-hidden="true">
              {l.done ? '✓' : ''}
            </span>
            <span>
              {l.text}
              {l.done ? <span class="sr-only"> (done)</span> : <small> {l.hint}</small>}
            </span>
          </li>
        ))}
      </ol>
      <button
        type="button"
        class="menu-button"
        data-testid="first-week-toggle"
        onClick={() => setHidden(!week.hidden)}
      >
        {week.hidden ? 'Show on the HUD' : 'Hide from the HUD'}
      </button>
    </section>
  );
}
