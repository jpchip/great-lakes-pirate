import type { MostWantedPage as Page } from '../../sim/news/papers';

/**
 * The tier-5 warning's full-screen front page (plan 13 §12, plan 06 §3.2; Phase 5 piece
 * F): the region's paper printing WANTED: DEAD OR ALIVE across the top, shown once per
 * region as it reaches Most Wanted, so the state is unmistakable before capture can
 * happen. The game waits behind it.
 */
export function MostWantedPage({ page, close }: { page: Page; close(): void }) {
  return (
    <div
      class="end-screen most-wanted-screen"
      data-testid="most-wanted-page"
      data-region={page.region}
      role="dialog"
      aria-modal="true"
      aria-label={page.headline}
    >
      <article class="newsprint most-wanted">
        <header class="newsprint-masthead">
          <div class="newsprint-ears">
            <span>Extra!</span>
            <span>
              {page.town}, {page.state}
            </span>
          </div>
          <h1 class="newsprint-paper">{page.paper}</h1>
          <div class="newsprint-dateline">{page.dateline}</div>
        </header>
        <h2 class="newsprint-headline most-wanted-headline" data-testid="most-wanted-headline">
          {page.headline}
        </h2>
        <h3 class="newsprint-deck">{page.deck}</h3>
        {page.reward && <p class="most-wanted-reward">{page.reward.toUpperCase()}</p>}
        <div class="newsprint-columns">
          {page.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
        <footer class="most-wanted-foot">
          <button
            type="button"
            class="menu-button primary"
            data-testid="most-wanted-close"
            onClick={close}
          >
            Put the paper down
          </button>
        </footer>
      </article>
    </div>
  );
}
