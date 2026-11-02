import { useEffect, useState } from 'preact/hooks';
import { formatCents } from '../../sim/economy/knowledge';
import type { TradeSide } from '../../sim/economy/market';
import { Ledger } from './Ledger';
import {
  CATEGORY_LABELS,
  type ElsewhereSnapshot,
  type HoldRow,
  type MarketRow,
  type OfferRow,
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
  /** The freight agent (piece F): take an offer, hand a contract back, sell its cargo. */
  acceptContract(offerId: string): string | undefined;
  abandonContract(contractId: string): string | undefined;
  stealContract(contractId: string): string | undefined;
  /** Close the screen and stay alongside. */
  close(): void;
  /** Close the screen and cast off (F). */
  castOff(): void;
}

const TAB_LABELS: Record<PortTab, string> = {
  market: 'Market',
  chandlery: 'Chandlery',
  freight: 'Freight agent',
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

/**
 * Contract cargo on a market that buys it can be sold: the theft of plan 05 §5.2. The
 * first click asks; the second sells, and burns the shipper for good.
 */
function StealButton({
  row,
  actions,
  setMessage,
}: {
  row: HoldRow;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  const [asking, setAsking] = useState(false);
  if (row.stealCents === undefined || !row.contractId) return null;
  const id = row.contractId;
  return (
    <button
      type="button"
      class={`port-mini${asking ? ' danger' : ''}`}
      data-testid={`steal-${id}`}
      title="Sell the shipper's cargo as your own. They will know who carried it."
      onClick={() => {
        if (!asking) {
          setAsking(true);
          setMessage(
            `Sell it for ${formatCents(row.stealCents ?? 0)}? The shipper will never deal with you again.`,
          );
          return;
        }
        setAsking(false);
        setMessage(actions.stealContract(id) ?? 'Sold. Word will get around.');
      }}
    >
      {asking ? 'Sell it' : 'Sell…'}
    </button>
  );
}

function Hold({
  port,
  actions,
  setMessage,
}: {
  port: PortSnapshot;
  actions?: PortActions;
  setMessage?(m: string | undefined): void;
}) {
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
                    ? `Carried for a contract${h.contractTo ? ` to ${h.contractTo}` : ''}`
                    : h.sellCents !== undefined
                      ? `${formatCents(h.sellCents)} here`
                      : 'Not traded here'}
              </small>
              {actions && setMessage && (
                <StealButton row={h} actions={actions} setMessage={setMessage} />
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

const KIND_LABEL: Record<OfferRow['kind'], string | undefined> = {
  freight: undefined,
  rush: 'Rush',
  mail: 'Mail',
  fragile: 'Fragile',
};

const KIND_HINT: Record<OfferRow['kind'], string> = {
  freight: '',
  rush: 'A tight deadline, and half again the pay',
  mail: 'Good pay, and double the Standing either way',
  fragile: 'Every hard knock on the way costs a quarter of the pay',
};

/**
 * The freight agent (plan 05 §5.2; plan 13 §5 contracts board): this week's offers with
 * their pay, deposit and deadline, the contracts in hand, and Standing with the port.
 */
function Freight({
  port,
  actions,
  setMessage,
}: {
  port: PortSnapshot;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  const f = port.freight;
  if (!f) return <p class="port-dim">No freight agent here.</p>;
  return (
    <div class="port-freight" data-testid="freight">
      <p class="menu-note">
        Standing with {port.portName}: <strong class="hud-num">{f.portStanding}</strong>
        {f.perks.length > 0 && <span class="port-dim"> · {f.perks.join(' · ')}</span>}. The board
        changes every week. The deposit comes back on delivery.
      </p>
      {f.offers.length === 0 ? (
        <p class="port-dim">Nothing on the board this week.</p>
      ) : (
        <table class="port-table" data-testid="offers-table">
          <thead>
            <tr>
              <th>Cargo</th>
              <th>To</th>
              <th>Shipper</th>
              <th class="num">Pays</th>
              <th class="num">Deposit</th>
              <th>Due if taken now</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {f.offers.map((o) => (
              <tr
                key={o.id}
                class={`port-row${o.locked ? ' locked' : ''}`}
                data-testid={`offer-${o.id}`}
              >
                <td>
                  {KIND_LABEL[o.kind] && (
                    <small class="port-kind" title={KIND_HINT[o.kind]}>
                      {KIND_LABEL[o.kind]}{' '}
                    </small>
                  )}
                  {o.qty} CU {o.cargo.toLowerCase()}
                  <br />
                  <small class="port-dim">{o.note}</small>
                </td>
                <td>{o.toName}</td>
                <td>
                  {o.company}
                  {o.companyTier && <small class="port-dim"> (company)</small>}
                </td>
                <td class="num hud-num">{formatCents(o.payCents)}</td>
                <td class="num hud-num">{o.depositCents ? formatCents(o.depositCents) : '—'}</td>
                <td>
                  <small>{o.dueText}</small>
                </td>
                <td class="port-actions">
                  <button
                    type="button"
                    class="port-mini"
                    data-testid={`accept-${o.id}`}
                    disabled={!!o.blocked}
                    title={o.blocked ?? 'Take it: the cargo goes aboard and the deposit is paid'}
                    onClick={() => setMessage(actions.acceptContract(o.id))}
                  >
                    Take
                  </button>
                  {o.blocked && (
                    <>
                      <br />
                      <small class="port-dim">{o.blocked}</small>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>In hand</h3>
      {f.held.length === 0 ? (
        <p class="port-dim">No contracts in hand.</p>
      ) : (
        <ul class="ledger-list" data-testid="held-contracts">
          {f.held.map((h) => (
            <li key={h.id} data-testid={`held-${h.id}`} class={h.status}>
              <span>
                {KIND_LABEL[h.kind] ? `${KIND_LABEL[h.kind]}: ` : ''}
                {h.aboard} of {h.qty} CU {h.cargo.toLowerCase()}, {h.fromName} → {h.toName} for{' '}
                {h.company}.{' '}
                {h.status === 'failed'
                  ? 'Failed: the agent takes the cargo back.'
                  : `Pays ${formatCents(h.payCents)}${h.status === 'late' ? ' (late: half)' : ''}, ${h.dueText}.`}
                {h.hits > 0 && ` Knocked about ${h.hits}×.`}
              </span>{' '}
              {h.status !== 'failed' && (
                <button
                  type="button"
                  class="port-mini"
                  data-testid={`abandon-${h.id}`}
                  title="Hand it back here: the cargo goes ashore and the deposit is lost"
                  onClick={() => setMessage(actions.abandonContract(h.id))}
                >
                  Hand back
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
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
        {port.notices.length > 0 && (
          <ul class="port-notices" role="status" data-testid="port-notices">
            {port.notices.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        {message && (
          <p class="port-message" role="status" data-testid="port-message">
            {message}
          </p>
        )}
        <div class="port-body">
          {shown === 'market' && (
            <>
              <Market port={port} actions={actions} setMessage={setMessage} />
              <Hold port={port} actions={actions} setMessage={setMessage} />
            </>
          )}
          {shown === 'chandlery' && (
            <>
              <Chandlery port={port} actions={actions} setMessage={setMessage} />
              <Hold port={port} />
            </>
          )}
          {shown === 'freight' && (
            <>
              <Freight port={port} actions={actions} setMessage={setMessage} />
              <Hold port={port} />
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
