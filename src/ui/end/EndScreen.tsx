import type { LastRun } from '../../sim/run/run-end';

/**
 * The end of the run (plan 12 §9, plan 13 §12; Phase 5 piece D): a front page in
 * letterpress newsprint (plan 13 §2), the run summary beside it, and the logbook to
 * download. The run is already deleted when this shows; the main menu starts a new one.
 */

/** A file name from the captain's name: "logbook-ida-bergquist.md". */
export function logbookFileName(captain: string): string {
  const slug = captain
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `logbook-${slug || 'captain'}.md`;
}

export function downloadLogbook(run: LastRun): void {
  const blob = new Blob([run.logbook], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = logbookFileName(run.captain);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function EndScreen({
  run,
  onMenu,
  menuLabel = 'To the main menu',
}: {
  run: LastRun;
  onMenu(): void;
  menuLabel?: string;
}) {
  const page = run.frontPage;
  return (
    <div class="end-screen" data-testid="end-screen" data-cause={run.cause}>
      <article class="newsprint" data-testid="front-page">
        <header class="newsprint-masthead">
          <div class="newsprint-ears">
            <span>Price two cents</span>
            <span>{page.town}, Wis.</span>
          </div>
          <h1 class="newsprint-paper">{page.paper}</h1>
          <div class="newsprint-dateline">{page.dateline}</div>
        </header>
        <h2 class="newsprint-headline" data-testid="front-headline">
          {page.headline}
        </h2>
        <h3 class="newsprint-deck">{page.deck}</h3>
        <div class="newsprint-columns">
          {page.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </article>
      <aside class="end-summary" data-testid="run-summary">
        <h2>
          Captain {run.captain} of the <i>{run.shipName}</i>
        </h2>
        <dl>
          {run.summary.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
        <p class="end-note">The run is over. Nothing carries over to the next captain.</p>
        <nav class="end-buttons">
          <button
            type="button"
            class="menu-button"
            data-testid="end-logbook"
            onClick={() => downloadLogbook(run)}
          >
            Download the logbook
          </button>
          <button type="button" class="menu-button primary" data-testid="end-menu" onClick={onMenu}>
            {menuLabel}
          </button>
        </nav>
      </aside>
    </div>
  );
}
