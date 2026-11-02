import { useEffect, useState } from 'preact/hooks';
import { formatCents } from '../../sim/economy/knowledge';
import type { TradeSide } from '../../sim/economy/market';
import { Ledger } from './Ledger';
import { Fittings, Shipyard, ShipPanel } from './Shipyard';
import {
  CATEGORY_LABELS,
  type ElsewhereSnapshot,
  type MarketRow,
  type PortSnapshot,
  type PortTab,
} from './model';

/**
 * The port screen (plan 05 §7, §12; plan 13 §5; Phase 4 piece B): it opens when the ship
 * docks at one of the port's piers and pauses the game. A tab per service the port has
 * (the market and the chandlery now), and the ledger. The market is the trade screen:
 * the port's goods with both prices and its stock, what you last saw them fetch
 * elsewhere, your hold with hot goods marked, the capacity bar, and a quantity slider.
 *
 * Plan 13 §6: the wheel moves the slider, shift-click on a row's Buy or Sell trades all
 * it can, ctrl-click trades one.
 */

export interface PortActions {
  /** Each returns why it was refused, in a few words, or undefined when it went through. */
  buy(good: string, qty: number): string | undefined;
  sell(good: string, qty: number): string | undefined;
  /** What `qty` CU would cost or fetch now, cents. */
  quote(good: string, qty: number, side: TradeSide): number;
  buyStores(item: string, qty: number): string | undefined;
  /** The shipyard and the chandlery's fittings (piece G). */
  buyHull(classId: string): string | undefined;
  fit(upgrade: string, place: 'shipyard' | 'chandlery'): string | undefined;
  unfit(upgrade: string, place: 'shipyard' | 'chandlery'): string | undefined;
  repair(place: 'shipyard' | 'chandlery'): string | undefined;
  /** Close the screen and stay alongside. */
  close(): void;
  /** Close the screen and cast off (F). */
  castOff(): void;
}

const TAB_LABELS: Record<PortTab, string> = {
  market: 'Market',
  chandlery: 'Chandlery',
  shipyard: 'Shipyard',
  ledger: 'Ledger',
};

/** The ember mark for hot goods: a shape as well as a color (plan 13 §2.2). */
function Ember() {
  return (
    <span class="ember" title="Hot: taken by crime" aria-label="hot">
      ◆
    </span>
  );
}

function Elsewhere({ seen, label }: { seen: ElsewhereSnapshot | undefined; label: string }) {
  if (!seen) return <span class="port-dim">—</span>;
  return (
    <span
      class={`port-elsewhere${seen.stale ? ' stale' : ''}`}
      title={`${label} at ${seen.portName}, ${seen.age}`}
    >
      {formatCents(seen.cents)} <small>{seen.portName}</small>
      <small class="port-age">, {seen.age}</small>
    </span>
  );
}

function CapacityBar({ port }: { port: PortSnapshot }) {
  const frac = port.capacity > 0 ? Math.min(1, port.usedCu / port.capacity) : 0;
  return (
    <div class="port-capacity" data-testid="port-capacity">
      <span>
        Hold{' '}
        <span class="hud-num">
          {port.usedCu} / {port.capacity} CU
        </span>
      </span>
      <div class="port-capacity-bar" aria-hidden="true">
        <div style={{ width: `${(frac * 100).toFixed(1)}%` }} />
      </div>
      <span class="port-dim">
        {port.speedLoss >= 0.005 ? `Laden: −${Math.round(port.speedLoss * 100)}% speed` : 'Light'}
      </span>
    </div>
  );
}

interface Selection {
  good: string;
  side: TradeSide;
}

function TradePanel({
  row,
  side,
  actions,
  onDone,
}: {
  row: MarketRow;
  side: TradeSide;
  actions: PortActions;
  onDone(message: string | undefined): void;
}) {
  const max = side === 'buy' ? row.maxBuy : row.held;
  const [qty, setQty] = useState(1);
  useEffect(() => setQty((q) => Math.max(1, Math.min(q, max))), [max, row.good, side]);
  if (max <= 0) {
    return (
      <div class="port-trade" data-testid="trade-panel">
        <p class="port-dim">
          {side === 'buy'
            ? row.stock < 1
              ? `No ${row.name.toLowerCase()} to be had here.`
              : 'No room in the hold, or not enough in the purse.'
            : `You have no clean ${row.name.toLowerCase()} to sell.`}
        </p>
      </div>
    );
  }
  const n = Math.max(1, Math.min(qty, max));
  const total = actions.quote(row.good, n, side);
  const go = (): void => {
    onDone(side === 'buy' ? actions.buy(row.good, n) : actions.sell(row.good, n));
  };
  return (
    <div
      class="port-trade"
      data-testid="trade-panel"
      onWheel={(e) => {
        e.preventDefault();
        setQty(Math.max(1, Math.min(max, n + (e.deltaY < 0 ? 1 : -1))));
      }}
    >
      <div class="port-trade-line">
        <strong>
          {side === 'buy' ? 'Buy' : 'Sell'} {row.name}
        </strong>
        <input
          type="range"
          min={1}
          max={max}
          step={1}
          value={n}
          data-testid="trade-qty"
          aria-label="Quantity"
          onInput={(e) => setQty(Number((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="hud-num" data-testid="trade-qty-text">
          {n} CU
        </span>
      </div>
      <div class="port-trade-line">
        <span>
          {side === 'buy' ? 'Cost' : 'Fetches'}{' '}
          <strong class="hud-num" data-testid="trade-total">
            {formatCents(total)}
          </strong>{' '}
          <span class="port-dim">({formatCents(total / n)} a CU)</span>
        </span>
        <span>
          <button type="button" class="menu-button" onClick={() => setQty(max)}>
            All ({max})
          </button>{' '}
          <button
            type="button"
            class="menu-button primary"
            data-testid="trade-confirm"
            onClick={go}
          >
            {side === 'buy' ? 'Buy' : 'Sell'}
          </button>
        </span>
      </div>
    </div>
  );
}

function Market({
  port,
  actions,
  setMessage,
}: {
  port: PortSnapshot;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  const [sel, setSel] = useState<Selection | undefined>(undefined);
  const row = sel && port.market.find((r) => r.good === sel.good);
  const quick = (r: MarketRow, side: TradeSide, e: MouseEvent): void => {
    // Shift-click trades all it can, ctrl-click one (plan 13 §6); a plain click picks.
    if (e.shiftKey || e.ctrlKey) {
      const max = side === 'buy' ? r.maxBuy : r.held;
      const qty = e.ctrlKey ? Math.min(1, max) : max;
      if (qty > 0)
        setMessage(side === 'buy' ? actions.buy(r.good, qty) : actions.sell(r.good, qty));
      setSel({ good: r.good, side });
      return;
    }
    setSel({ good: r.good, side });
  };
  let category = '';
  return (
    <div class="port-market">
      <table class="port-table" data-testid="market-table">
        <thead>
          <tr>
            <th>Good</th>
            <th class="num" title="What they ask: your price to buy a CU">
              Buy
            </th>
            <th class="num" title="What they pay: your price to sell a CU">
              Sell
            </th>
            <th class="num" title="CU in the port's stores">
              Stock
            </th>
            <th class="num">Aboard</th>
            <th title="The best price you know of to sell it elsewhere">Best sale elsewhere</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {port.market.map((r) => {
            const header =
              r.category !== category ? (
                <tr class="port-category" key={`cat-${r.category}`}>
                  <td colSpan={7}>{CATEGORY_LABELS[r.category]}</td>
                </tr>
              ) : null;
            category = r.category;
            const selected = sel?.good === r.good;
            return [
              header,
              <tr
                key={r.good}
                class={`port-row${selected ? ' selected' : ''}`}
                data-testid={`market-row-${r.good}`}
                data-good={r.good}
              >
                <td>
                  {r.name}
                  {r.role !== 'neutral' && (
                    <small
                      class="port-role"
                      title={r.role === 'export' ? 'Made here: cheap' : 'Wanted here: dear'}
                    >
                      {r.role === 'export' ? ' made here' : ' wanted here'}
                    </small>
                  )}
                </td>
                <td class="num hud-num">{formatCents(r.buyCents)}</td>
                <td class="num hud-num">{formatCents(r.sellCents)}</td>
                <td class="num hud-num">{r.stock}</td>
                <td class="num hud-num">{r.held || ''}</td>
                <td>
                  <Elsewhere seen={r.bestSale} label="Paid" />
                </td>
                <td class="port-actions">
                  <button
                    type="button"
                    class="port-mini"
                    data-testid={`buy-${r.good}`}
                    disabled={r.maxBuy <= 0}
                    title="Buy (shift-click: all you can, ctrl-click: one)"
                    onClick={(e) => quick(r, 'buy', e)}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    class="port-mini"
                    data-testid={`sell-${r.good}`}
                    disabled={r.held <= 0}
                    title="Sell (shift-click: all, ctrl-click: one)"
                    onClick={(e) => quick(r, 'sell', e)}
                  >
                    Sell
                  </button>
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      {row && sel && (
        <TradePanel row={row} side={sel.side} actions={actions} onDone={(m) => setMessage(m)} />
      )}
    </div>
  );
}

function Hold({ port }: { port: PortSnapshot }) {
  return (
    <aside class="port-hold" data-testid="port-hold">
      <h3>Your hold</h3>
      <CapacityBar port={port} />
      {port.hold.length === 0 ? (
        <p class="port-dim">Empty.</p>
      ) : (
        <ul>
          {port.hold.map((h, i) => (
            <li key={`${h.good}-${i}`} class={h.hot ? 'hot' : ''} data-testid="hold-row">
              <span>
                {h.hot && <Ember />} {h.name}
                {h.contract && <small class="port-dim"> (contract)</small>}
              </span>
              <span class="hud-num">{h.qty} CU</span>
              <small class="port-dim">
                {h.hot
                  ? 'No honest merchant will take it'
                  : h.contract
                    ? 'Carried for a contract'
                    : h.sellCents !== undefined
                      ? `${formatCents(h.sellCents)} here`
                      : 'Not traded here'}
              </small>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Chandlery({
  port,
  actions,
  setMessage,
}: {
  port: PortSnapshot;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  return (
    <div class="port-chandlery">
      <p class="menu-note">
        Ship's stores go in the lockers, not the hold. The chandler doesn't buy them back.
      </p>
      <table class="port-table" data-testid="chandlery-table">
        <thead>
          <tr>
            <th>Store</th>
            <th class="num">Price</th>
            <th class="num">Aboard</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {port.stores.map((s) => (
            <tr key={s.id} class="port-row">
              <td>
                {s.name}
                <br />
                <small class="port-dim">{s.blurb}</small>
              </td>
              <td class="num hud-num">{formatCents(s.priceCents)}</td>
              <td class="num hud-num">
                {s.have} / {s.max}
              </td>
              <td class="port-actions">
                <button
                  type="button"
                  class="port-mini"
                  data-testid={`store-${s.id}`}
                  disabled={s.maxBuy <= 0}
                  title="Buy one (shift-click: fill the locker)"
                  onClick={(e) => setMessage(actions.buyStores(s.id, e.shiftKey ? s.maxBuy : 1))}
                >
                  Buy
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PortScreen({
  port,
  actions,
  tab,
  setTab,
}: {
  port: PortSnapshot;
  actions: PortActions;
  tab: PortTab;
  setTab(tab: PortTab): void;
}) {
  const [message, setMessage] = useState<string | undefined>(undefined);
  const shown = port.tabs.includes(tab) ? tab : (port.tabs[0] ?? 'ledger');
  return (
    <div class="menu-backdrop" data-testid="port-screen" data-port={port.port}>
      <div class="menu port" role="dialog" aria-modal="true" aria-label={port.portName}>
        <header class="menu-header">
          <h2>{port.portName}</h2>
          <span class="port-purse">
            {port.dateText} · Purse{' '}
            <strong class="hud-num" data-testid="port-purse">
              {formatCents(port.purseCents)}
            </strong>
          </span>
        </header>
        <nav class="menu-tabs">
          {port.tabs.map((id) => (
            <button
              type="button"
              key={id}
              class={`menu-tab${shown === id ? ' active' : ''}`}
              data-testid={`port-tab-${id}`}
              onClick={() => {
                setTab(id);
                setMessage(undefined);
              }}
            >
              {TAB_LABELS[id]}
            </button>
          ))}
        </nav>
        {message && (
          <p class="port-message" role="status" data-testid="port-message">
            {message}
          </p>
        )}
        <div class="port-body">
          {shown === 'market' && (
            <>
              <Market port={port} actions={actions} setMessage={setMessage} />
              <Hold port={port} />
            </>
          )}
          {shown === 'chandlery' && (
            <>
              <div class="port-chandlery-col">
                <Chandlery port={port} actions={actions} setMessage={setMessage} />
                {port.fittings && (
                  <Fittings yard={port.fittings} actions={actions} setMessage={setMessage} />
                )}
              </div>
              <Hold port={port} />
            </>
          )}
          {shown === 'shipyard' && port.shipyard && (
            <>
              <Shipyard yard={port.shipyard} actions={actions} setMessage={setMessage} />
              <ShipPanel yard={port.shipyard} />
            </>
          )}
          {shown === 'ledger' && <Ledger ledger={port.ledger} here={port.port} />}
        </div>
        <footer class="menu-footer port-footer">
          <button
            type="button"
            class="menu-button"
            data-testid="port-cast-off"
            onClick={actions.castOff}
          >
            Cast off (F)
          </button>
          <button
            type="button"
            class="menu-button primary"
            data-testid="port-close"
            onClick={actions.close}
          >
            Back aboard (Esc)
          </button>
        </footer>
      </div>
    </div>
  );
}
