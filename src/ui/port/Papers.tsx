import { useState } from 'preact/hooks';
import type { PortActions } from './PortScreen';
import { priceEar, type PaperView, type PapersSnapshot } from './papers-model';

/**
 * The newsstand (plan 13 §12 "newspaper reader v1", plan 12 §6.2; Phase 5 piece F): the
 * papers sold in this port down the side, and the chosen one's front page in letterpress
 * newsprint (plan 13 §2): the lead, the briefs, the WANTED column, cutter sightings, the
 * weather outlook with the storm signals, and an ad. Until it's bought, the paper boy
 * only holds up the headline.
 */

function Masthead({ p }: { p: PaperView }) {
  return (
    <header class="newsprint-masthead">
      <div class="newsprint-ears">
        <span>{priceEar(p.priceCents)}</span>
        <span>
          {p.town}, {p.state}
        </span>
      </div>
      <h1 class="newsprint-paper">{p.name}</h1>
      <div class="newsprint-dateline">{p.edition?.dateline ?? 'Not yet in'}</div>
    </header>
  );
}

function Front({ p, buy }: { p: PaperView; buy(): void }) {
  const e = p.edition;
  if (!e) {
    return (
      <article class="newsprint paper-page" data-testid="paper-page">
        <Masthead p={p} />
        <p class="paper-empty">The papers are not in yet.</p>
      </article>
    );
  }
  return (
    <article class="newsprint paper-page" data-testid="paper-page" data-read={String(p.read)}>
      <Masthead p={p} />
      <h2 class="newsprint-headline paper-headline" data-testid="paper-headline">
        {e.lead.headline}
      </h2>
      <h3 class="newsprint-deck">{e.lead.deck}</h3>
      {!p.read ? (
        <div class="paper-buy">
          <p>
            {e.ageDays > 0
              ? `Last week's paper, still on the stand.`
              : 'The paper boy holds it up and shouts the headline.'}
          </p>
          <button
            type="button"
            class="menu-button primary"
            data-testid="paper-buy"
            disabled={!p.affordable}
            onClick={buy}
          >
            Buy it ({p.priceText})
          </button>
        </div>
      ) : (
        <>
          <div class="newsprint-columns paper-lead">
            <p>{e.lead.body}</p>
          </div>
          <div class="paper-grid">
            <section class="paper-col">
              <h4>News of the Lake</h4>
              {e.briefs.length === 0 ? (
                <p class="paper-dim">Nothing more of note this week.</p>
              ) : (
                e.briefs.map((b) => (
                  <div class="paper-brief" key={b.headline} data-about-you={String(b.aboutYou)}>
                    <h5>{b.headline}</h5>
                    <p>{b.body}</p>
                  </div>
                ))
              )}
            </section>
            <section class="paper-col paper-wanted" data-testid="paper-wanted">
              <h4>Wanted</h4>
              {e.wanted.length === 0 ? (
                <p class="paper-dim">No notices this week.</p>
              ) : (
                e.wanted.map((w) => (
                  <div class={`paper-notice tier-${w.tier}`} key={w.region}>
                    <h5>{w.headline}</h5>
                    <p class="paper-notice-subject">{w.subject}</p>
                    <p>{w.detail}</p>
                    <p>{w.charge}.</p>
                    {w.reward && <p class="paper-notice-reward">{w.reward}</p>}
                  </div>
                ))
              )}
            </section>
            <section class="paper-col">
              <h4>The Revenue Cutter</h4>
              <div data-testid="paper-cutter">
                {e.cutter.length === 0 ? (
                  <p class="paper-dim">No word of the cutter this week.</p>
                ) : (
                  e.cutter.map((c) => <p key={c}>{c}</p>)
                )}
              </div>
              <h4>Weather</h4>
              <p data-testid="paper-weather">{e.weather}</p>
              {e.signals && (
                <p class="paper-signals" data-testid="paper-signals">
                  {e.signals}
                </p>
              )}
              <p class="paper-ad">{e.ad}</p>
            </section>
          </div>
        </>
      )}
    </article>
  );
}

export function Papers({
  papers,
  actions,
  setMessage,
}: {
  papers: PapersSnapshot;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const shown = papers.papers.find((p) => p.id === chosen) ?? papers.papers[0];
  if (!shown) return <p class="port-dim">No papers are sold here.</p>;
  return (
    <div class="papers" data-testid="papers">
      <ul class="papers-stand">
        {papers.papers.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              class={`papers-pick${p.id === shown.id ? ' active' : ''}`}
              data-testid={`paper-pick-${p.id}`}
              onClick={() => {
                setChosen(p.id);
                setMessage(undefined);
              }}
            >
              <span class="papers-name">{p.name}</span>
              <span class="port-dim">{p.read ? 'Bought' : p.priceText}</span>
            </button>
          </li>
        ))}
      </ul>
      <Front p={shown} buy={() => setMessage(actions.buyPaper?.(shown.id))} />
    </div>
  );
}
