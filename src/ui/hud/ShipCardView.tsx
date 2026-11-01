import type { ReadonlySignal } from '@preact/signals';
import type { ShipCard } from './ship-card';

/**
 * "Look her over" and hail results (Phase 4 piece D): a logbook-paper card on the left
 * of the helm with who she is, her owner, her passage, her hold, and her news.
 */
export function ShipCardView({ card }: { card: ReadonlySignal<ShipCard | undefined> }) {
  const c = card.value;
  if (!c) return null;
  return (
    <aside class="ship-card" data-testid="ship-card" data-ship={c.shipId} aria-live="polite">
      <h2 class="ship-card-title">{c.title}</h2>
      <div class="ship-card-sub">{c.subtitle}</div>
      {c.route && <div class="ship-card-route">{c.route}</div>}
      <ul class="ship-card-cargo" data-testid="ship-card-cargo">
        {c.cargo.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {(c.value || c.crew) && (
        <div class="ship-card-meta">{[c.value, c.crew].filter(Boolean).join(' · ')}</div>
      )}
      {c.news && (
        <div class="ship-card-news" data-testid="ship-card-news">
          {c.news.heading && <div class="ship-card-news-head">{c.news.heading}</div>}
          {c.news.prices.length > 0 && (
            <table class="ship-card-prices">
              <thead>
                <tr>
                  <th />
                  <th>Buy</th>
                  <th>Sell</th>
                </tr>
              </thead>
              <tbody>
                {c.news.prices.map((p) => (
                  <tr key={p.good}>
                    <td>{p.good}</td>
                    <td class="hud-num">{p.buy}</td>
                    <td class="hud-num">{p.sell}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {c.news.rumor && <p class="ship-card-rumor">{c.news.rumor}</p>}
        </div>
      )}
    </aside>
  );
}
