import { useState } from 'preact/hooks';
import { formatCents } from '../../sim/economy/knowledge';
import type { SmugglerLot, SmugglerSnapshot } from './smuggler-model';

/**
 * Alongside the island smuggler after dark (plan 05 §6.2, §12 "Fence screen"; Phase 4
 * piece H). The port screen's ledger paper by lantern light: what she sells tonight, and
 * every lot in the hold with her rate for it, out of her cash for the week. No detection
 * risk here. Plan 13 §6: shift-click deals all you can, a plain click one CU.
 */

export interface SmugglerActions {
  /** Each returns why it was refused, in a few words, or undefined when it went through. */
  buy(good: string, qty: number): string | undefined;
  fence(index: number, qty: number): string | undefined;
  /** Sheer off (Esc or F). */
  close(): void;
}

function Ember() {
  return (
    <span class="ember" title="Hot: taken by crime" aria-label="hot">
      ◆
    </span>
  );
}

function lotNote(l: SmugglerLot): string {
  if (l.refusal) return l.refusal;
  if (l.maxQty <= 0) return "She hasn't the cash left for it";
  return `${l.ratePct}% of its value`;
}

export function SmugglerScreen({
  smuggler: s,
  actions,
}: {
  smuggler: SmugglerSnapshot;
  actions: SmugglerActions;
}) {
  const [message, setMessage] = useState<string | undefined>(undefined);
  return (
    <div class="menu-backdrop" data-testid="smuggler-screen">
      <div class="menu port smuggler" role="dialog" aria-modal="true" aria-label={s.boatName}>
        <header class="menu-header">
          <h2>
            <em>{s.boatName}</em>
          </h2>
          <span class="port-purse">
            {s.anchorageName} · {s.dateText} · Purse{' '}
            <strong class="hud-num" data-testid="smuggler-purse">
              {formatCents(s.purseCents)}
            </strong>
          </span>
        </header>
        <p class="menu-note">
          {s.blurb} {s.trustText}. She has{' '}
          <strong class="hud-num" data-testid="smuggler-cash">
            {formatCents(s.cashCents)}
          </strong>{' '}
          left to buy with this week.
        </p>
        {message && (
          <p class="port-message" role="status" data-testid="smuggler-message">
            {message}
          </p>
        )}
        <div class="port-body">
          <div class="port-market">
            <h3>She sells</h3>
            <table class="port-table" data-testid="smuggler-sells">
              <thead>
                <tr>
                  <th>Good</th>
                  <th class="num">Price</th>
                  <th class="num">She has</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.sells.map((g) => (
                  <tr key={g.good} class="port-row">
                    <td>{g.name}</td>
                    <td class="num hud-num">{formatCents(g.priceCents)}</td>
                    <td class="num hud-num">{g.stock}</td>
                    <td class="port-actions">
                      <button
                        type="button"
                        class="port-mini"
                        data-testid={`smuggler-buy-${g.good}`}
                        disabled={g.maxBuy <= 0}
                        title="Buy one CU (shift-click: all you can)"
                        onClick={(e) => setMessage(actions.buy(g.good, e.shiftKey ? g.maxBuy : 1))}
                      >
                        Buy
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p class="menu-note">
              Contraband can't be sold openly. A merchant may take it on the quiet, or may not.
            </p>
          </div>
          <aside class="port-hold" data-testid="smuggler-lots">
            <h3>Your hold</h3>
            <p class="port-dim hud-num">
              {s.usedCu} / {s.capacity} CU
            </p>
            {s.lots.length === 0 ? (
              <p class="port-dim">Empty.</p>
            ) : (
              <ul>
                {s.lots.map((l) => (
                  <li
                    key={`${l.good}-${l.index}`}
                    class={l.hot ? 'hot' : ''}
                    data-testid="smuggler-lot"
                  >
                    <span>
                      {l.hot && <Ember />} {l.name}
                    </span>
                    <span class="hud-num">{l.qty} CU</span>
                    <small class="port-dim">
                      {lotNote(l)}
                      {l.unitCents !== undefined &&
                        !l.refusal &&
                        ` · ${formatCents(l.unitCents)} a CU`}
                    </small>
                    {!l.refusal && (
                      <button
                        type="button"
                        class="port-mini"
                        data-testid={`smuggler-sell-${l.good}`}
                        disabled={l.maxQty <= 0}
                        title="Sell her one CU (shift-click: all her cash covers)"
                        onClick={(e) =>
                          setMessage(actions.fence(l.index, e.shiftKey ? l.maxQty : 1))
                        }
                      >
                        Sell
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
        <footer class="menu-footer port-footer">
          <button
            type="button"
            class="menu-button primary"
            data-testid="smuggler-close"
            onClick={actions.close}
          >
            Sheer off (Esc)
          </button>
        </footer>
      </div>
    </div>
  );
}
