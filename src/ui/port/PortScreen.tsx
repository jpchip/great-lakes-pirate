import { useEffect, useState } from 'preact/hooks';
import { formatCents } from '../../sim/economy/knowledge';
import type { TradeSide } from '../../sim/economy/market';
import type { LieUntil } from '../../sim/hideouts/lie-at-anchor';
import type { FitSource } from '../../sim/shipyard/shipyard';
import { LieButtons } from '../stash/StashScreen';
import { BackRoom } from './BackRoom';
import { Harbor } from './Harbor';
import { Help } from './Help';
import { Ledger, RumorItem } from './Ledger';
import { Papers } from './Papers';
import { Fittings, Shipyard, ShipPanel } from './Shipyard';
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
  /** Buys a round in the saloon for a rumor (piece K); the refusal, or undefined. */
  buyRound(): string | undefined;
  /**
   * Offers a whole hot or contraband lot (a stack of the hold, by its index) to the port's
   * merchants (piece H). Always returns what came of it, in a line.
   */
  offer(index: number): string | undefined;
  /** The freight agent (piece F): take an offer, hand a contract back, sell its cargo. */
  acceptContract(offerId: string): string | undefined;
  abandonContract(contractId: string): string | undefined;
  stealContract(contractId: string): string | undefined;
  /** The shipyard and the chandlery's fittings (piece G). */
  buyHull(classId: string): string | undefined;
  fit(upgrade: string, place: FitSource): string | undefined;
  unfit(upgrade: string, place: FitSource): string | undefined;
  repair(place: 'shipyard' | 'chandlery'): string | undefined;
  /**
   * Sells `qty` CU of a lot (by its index in the hold) to the fence in the back room
   * (Phase 6 piece E): the refusal, or what came of it, in a line.
   */
  fence?(index: number, qty: number): string | undefined;
  /** Mounts a gun from the shady shipwright's back room (Phase 6 piece E). */
  buyGun?(gunId: string): string | undefined;
  /** The harbor master (Phase 5 piece E): pay the fine or bribe on offer; what came of it. */
  payHarbor?(kind: 'fine' | 'bribe'): string | undefined;
  /** The newsstand (Phase 5 piece F): buy a paper's latest edition; the refusal. */
  buyPaper?(paper: string): string | undefined;
  /** Close the screen and stay alongside. */
  close(): void;
  /** Close the screen and cast off (F). */
  castOff(): void;
  /** Close the screen and go ashore down the gangway (G; Phase 7 piece A). */
  goAshore?(): void;
  /**
   * Waits alongside (the lie-at-anchor clock): the refusal, or what the wait came to, in a
   * line. Optional so the screen still works without it.
   */
  wait?(until: LieUntil): string | undefined;
}

const TAB_LABELS: Record<PortTab, string> = {
  market: 'Market',
  chandlery: 'Chandlery',
  saloon: 'Saloon',
  backRoom: 'Back room',
  papers: 'Papers',
  freight: 'Freight agent',
  shipyard: 'Shipyard',
  harbor: 'Harbor master',
  ledger: 'Ledger',
};

/** The ember mark for hot goods: a shape as well as a color (plan 13 §2.2). */

/** The names of the goods this port makes (`export`) or wants (`import`), for the hint line. */
function goodsWith(port: PortSnapshot, role: 'export' | 'import'): string {
  return port.market
    .filter((r) => r.role === role)
    .map((r) => r.name.toLowerCase())
    .join(', ');
}

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
        {port.speedLoss >= 0.005 ? `−${Math.round(port.speedLoss * 100)}% speed` : ''}
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
      <p class="port-trade-hints" data-testid="market-hints">
        <span class="port-role made">▾ Made here</span>{' '}
        {goodsWith(port, 'export') || 'little of note'}
        <span class="port-role wanted">▴ Wanted here</span>{' '}
        {goodsWith(port, 'import') || 'nothing in particular'}
      </p>
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
            <th title="The best price you know of to sell it elsewhere">Elsewhere</th>
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
                    <span
                      class={`port-role port-role-icon ${r.role === 'export' ? 'made' : 'wanted'}`}
                      data-testid={`role-${r.role}`}
                      aria-label={r.role === 'export' ? 'made here' : 'wanted here'}
                      title={
                        r.role === 'export'
                          ? 'Made here: cheap to buy, a poor place to sell'
                          : "Wanted here: dear, and they'll pay well for it"
                      }
                    >
                      {r.role === 'export' ? '▾' : '▴'}
                    </span>
                  )}
                </td>
                <td class="num hud-num">{formatCents(r.buyCents)}</td>
                <td class="num hud-num">{formatCents(r.sellCents)}</td>
                <td class="num hud-num">{r.stock}</td>
                <td class="num hud-num">
                  {r.held || ''}
                  {r.held > 0 && r.heldPaidCents !== undefined && (
                    <small class="port-dim port-paid" title="What a CU of it aboard cost you">
                      {' '}
                      @ {formatCents(r.heldPaidCents)}
                    </small>
                  )}
                </td>
                <td>
                  <Elsewhere seen={r.bestSale} label="Paid" />
                </td>
                <td class="port-actions">
                  <button
                    type="button"
                    class="port-mini"
                    data-testid={`buy-${r.good}`}
                    disabled={r.maxBuy <= 0}
                    title={r.restricted ?? 'Buy (shift-click: all you can, ctrl-click: one)'}
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
  actions?: PortActions | undefined;
  setMessage?: ((m: string | undefined) => void) | undefined;
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
              <span
                title={
                  h.hot
                    ? 'No honest merchant will take it'
                    : h.contract
                      ? `Carried for a contract${h.contractTo ? ` to ${h.contractTo}` : ''}`
                      : h.sellCents === undefined
                        ? 'Not traded here'
                        : undefined
                }
              >
                {h.hot && <Ember />} {h.name}
                {h.contract && <small class="port-dim"> (contract)</small>}
              </span>
              <span class="hud-num">{h.qty} CU</span>
              {h.paidCents !== undefined && !h.hot && (
                <small class="port-dim" data-testid="hold-paid" title="What a CU cost you">
                  paid {formatCents(h.paidCents)}
                </small>
              )}
              {h.offer ? (
                <small class="port-dim">
                  {h.offer.tooHot
                    ? 'Too hot for your receiver here'
                    : h.offer.receiver
                      ? h.offer.informRisk
                        ? `Your receiver here takes it, but the law's asking: ${h.offer.informRisk} he talks`
                        : 'Your receiver here takes it'
                      : h.offer.turnedAway
                        ? 'Turned away here this week'
                        : `Offer it on the quiet: ${h.offer.risk}`}
                </small>
              ) : (
                h.sellCents !== undefined && (
                  <small class="port-dim">{formatCents(h.sellCents)} here</small>
                )
              )}
              {h.offer && actions && setMessage && (
                <button
                  type="button"
                  class="port-mini"
                  data-testid={`offer-${h.good}`}
                  disabled={h.offer.turnedAway || h.offer.tooHot}
                  title={
                    h.offer.kind === 'hot'
                      ? 'Offer the whole lot to a merchant. If they know the goods, they refuse or call the law.'
                      : 'Offer the whole lot to a merchant on the quiet. If they won’t have it, they refuse or call the revenue man.'
                  }
                  onClick={() => setMessage(actions.offer(h.index))}
                >
                  Offer
                </button>
              )}
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
 * The freight agent (plan 05 §5.2; plan 13 §5 contracts board). Each offer is one line:
 * where it goes and what, the pay, and Take. The shipper, deposit and time allowed sit
 * small beneath; the exact due date and the shipper's note are in the tooltip.
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
      <div class="freight-head">
        <h3>This week's board</h3>
        <span
          class="freight-standing"
          title={f.perks.length ? f.perks.join(' · ') : 'Deliver on time to raise it'}
        >
          Standing <strong class="hud-num">{f.portStanding}</strong>
        </span>
      </div>
      {f.offers.length === 0 ? (
        <p class="port-dim">Nothing on the board this week.</p>
      ) : (
        <ul class="freight-list" data-testid="offers-table">
          {f.offers.map((o) => (
            <li
              key={o.id}
              class={`freight-card${o.locked ? ' locked' : ''}`}
              data-testid={`offer-${o.id}`}
              title={`${o.note}. Due ${o.dueText}.${KIND_HINT[o.kind] ? ` ${KIND_HINT[o.kind]}.` : ''}`}
            >
              <div class="freight-main">
                <span class="freight-route">
                  {KIND_LABEL[o.kind] && <span class="port-kind">{KIND_LABEL[o.kind]} </span>}
                  {o.qty} CU {o.cargo.toLowerCase()} <span class="port-dim">to</span> {o.toName}
                </span>
                <small class="port-dim">
                  {o.company}
                  {o.companyTier ? ' (company)' : ''} · {o.dueShort}
                  {o.depositCents ? ` · deposit ${formatCents(o.depositCents)}` : ''}
                </small>
              </div>
              <strong class="freight-pay hud-num">{formatCents(o.payCents)}</strong>
              {o.blocked ? (
                <small class="freight-blocked" data-testid={`blocked-${o.id}`}>
                  {o.blocked}
                </small>
              ) : (
                <button
                  type="button"
                  class="port-mini"
                  data-testid={`accept-${o.id}`}
                  onClick={() => setMessage(actions.acceptContract(o.id))}
                >
                  Take
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {f.held.length > 0 && (
        <>
          <h3>In hand</h3>
          <ul class="freight-list" data-testid="held-contracts">
            {f.held.map((h) => (
              <li
                key={h.id}
                data-testid={`held-${h.id}`}
                class={`freight-card ${h.status}`}
                title={h.status === 'failed' ? undefined : `Due ${h.dueText}`}
              >
                <div class="freight-main">
                  <span class="freight-route">
                    {h.aboard} CU {h.cargo.toLowerCase()} <span class="port-dim">to</span>{' '}
                    {h.toName}
                  </span>
                  <small class="port-dim">
                    {h.status === 'failed'
                      ? 'Failed: the agent takes the cargo back'
                      : `${h.dueShort}${h.status === 'late' ? ', late: half pay' : ''}${h.hits ? ` · knocked ${h.hits}×` : ''}`}
                  </small>
                </div>
                <strong class="freight-pay hud-num">
                  {h.status === 'failed' ? '—' : formatCents(h.payCents)}
                </strong>
                {h.status !== 'failed' ? (
                  <button
                    type="button"
                    class="port-mini"
                    data-testid={`abandon-${h.id}`}
                    title="Hand it back here: the cargo goes ashore and the deposit is lost"
                    onClick={() => setMessage(actions.abandonContract(h.id))}
                  >
                    Hand back
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** What the chandler sells by the keg into the hold: ammunition (Phase 6 piece E). */
const CHANDLERY_CARGO = ['good.powder_shot'];

/**
 * Powder and shot at the chandlery (plan 05 §7; Phase 6 piece E): the same lot the market
 * sells, at its price, bought here by the keg (a CU) into the hold. Guns use it per shot.
 */
function ChandleryCargo({
  port,
  actions,
  setMessage,
}: {
  port: PortSnapshot;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  const rows = port.market.filter((r) => CHANDLERY_CARGO.includes(r.good));
  if (rows.length === 0) return null;
  return (
    <table class="port-table" data-testid="chandlery-cargo">
      <thead>
        <tr>
          <th>
            Ammunition
            <Help text="Powder and shot go in the hold, a keg to the CU, and the guns use them a shot at a time. Nobody sells powder to a captain with a WANTED poster up." />
          </th>
          <th class="num">A CU</th>
          <th class="num">Aboard</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.good} class="port-row" title={r.restricted}>
            <td>{r.name}</td>
            <td class="num hud-num">{formatCents(r.buyCents)}</td>
            <td class="num hud-num">{r.held}</td>
            <td class="port-actions">
              <button
                type="button"
                class="port-mini"
                data-testid={`chandlery-buy-${r.good}`}
                disabled={r.maxBuy <= 0}
                title={r.restricted ?? 'Buy a keg (shift-click: all you can)'}
                onClick={(e) =>
                  setMessage(
                    actions.buy(r.good, e.shiftKey ? r.maxBuy : 1) ??
                      `${e.shiftKey ? r.maxBuy : 1} CU of ${r.name.toLowerCase()} stowed.`,
                  )
                }
              >
                Buy
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
      <table class="port-table" data-testid="chandlery-table">
        <thead>
          <tr>
            <th>
              Stores
              <Help text="Ship's stores go in the lockers, not the hold. The chandler doesn't buy them back." />
            </th>
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
                <Help text={s.blurb} />
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

function Saloon({
  port,
  actions,
  setMessage,
}: {
  port: PortSnapshot;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  const s = port.saloon;
  if (!s) return null;
  const price = s.free ? 'on the house' : formatCents(s.roundCents);
  return (
    <div class="port-saloon" data-testid="saloon">
      <p class="menu-note">
        Stand a round and the talk comes easier. Some of it is true. A round here is{' '}
        {formatCents(s.listCents)}
        {s.free ? '; the keeper knows a fellow saloon man, and the first is on the house' : ''}.
      </p>
      <p>
        <button
          type="button"
          class="menu-button primary"
          data-testid="saloon-round"
          disabled={s.roundsLeft <= 0 || port.purseCents < s.roundCents}
          onClick={() => setMessage(actions.buyRound())}
        >
          Buy a round ({price})
        </button>{' '}
        <span class="port-dim" data-testid="saloon-left">
          {s.roundsLeft > 0
            ? `Talk enough for ${s.roundsLeft} more round${s.roundsLeft === 1 ? '' : 's'} today.`
            : "The bar's talked out for today."}
        </span>
      </p>
      {port.backRoomHint && (
        <p class="menu-note" data-testid="back-room-hint">
          {port.backRoomHint}
        </p>
      )}
      {s.heard.length === 0 ? (
        <p class="port-dim">Nobody's said anything worth writing down yet.</p>
      ) : (
        <ul class="ledger-list rumors">
          {s.heard.map((r) => (
            <RumorItem key={r.id} r={r} />
          ))}
        </ul>
      )}
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
            {port.stashedCents ? (
              <span class="port-dim" data-testid="port-stashed">
                {' '}
                · Stashed {formatCents(port.stashedCents)}
              </span>
            ) : null}
          </span>
          {port.stormSignal && (
            <span
              class="port-storm-signal"
              data-testid="port-storm-signal"
              title="A big low is coming: the barometer is falling fast here"
            >
              <span class={`storm-signal-mark ${port.stormSignal}`} aria-hidden="true" />
              {port.stormSignal === 'flag' ? 'Storm flag flying' : 'Storm light shown'}
            </span>
          )}
          {port.harbor?.poster && shown !== 'harbor' && (
            <button
              type="button"
              class="port-poster-badge"
              data-testid="port-poster-badge"
              title="A WANTED poster is up on the harbor master's board"
              onClick={() => {
                setTab('harbor');
                setMessage(undefined);
              }}
            >
              {port.harbor.poster.headline}
            </button>
          )}
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
              <div class="port-chandlery-col">
                <Chandlery port={port} actions={actions} setMessage={setMessage} />
                <ChandleryCargo port={port} actions={actions} setMessage={setMessage} />
                {port.fittings && (
                  <Fittings yard={port.fittings} actions={actions} setMessage={setMessage} />
                )}
              </div>
              <Hold port={port} />
            </>
          )}
          {shown === 'saloon' && <Saloon port={port} actions={actions} setMessage={setMessage} />}
          {shown === 'backRoom' && port.backRoom && (
            <BackRoom room={port.backRoom} actions={actions} setMessage={setMessage} />
          )}
          {shown === 'freight' && (
            <>
              <Freight port={port} actions={actions} setMessage={setMessage} />
              <Hold port={port} />
            </>
          )}
          {shown === 'shipyard' && port.shipyard && (
            <>
              <Shipyard yard={port.shipyard} actions={actions} setMessage={setMessage} />
              <ShipPanel yard={port.shipyard} />
            </>
          )}
          {shown === 'papers' && port.papers && (
            <Papers papers={port.papers} actions={actions} setMessage={setMessage} />
          )}
          {shown === 'harbor' && port.harbor && (
            <Harbor harbor={port.harbor} actions={actions} setMessage={setMessage} />
          )}
          {shown === 'ledger' && <Ledger ledger={port.ledger} here={port.port} />}
        </div>
        <footer class="menu-footer port-footer">
          {port.canWait && actions.wait && (
            <LieButtons
              label="Wait"
              refusal={port.waitRefusal}
              lie={actions.wait}
              setMessage={setMessage}
            />
          )}
          {actions.goAshore && port.canGoAshore && (
            <button
              type="button"
              class="menu-button"
              data-testid="port-go-ashore"
              onClick={actions.goAshore}
            >
              Go ashore (G)
            </button>
          )}
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
