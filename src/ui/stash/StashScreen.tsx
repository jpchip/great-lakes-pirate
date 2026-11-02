import { useEffect, useState } from 'preact/hooks';
import { formatCents } from '../../sim/economy/knowledge';
import type { LieUntil } from '../../sim/hideouts/lie-at-anchor';
import type { StashActions } from '../../gameplay/stash';
import type { StashRow, StashSnapshot } from './model';

/**
 * The stash screen (plan 13 §5 "Storage transfer", plan 09 §3; Phase 4 piece E): opens
 * alongside the Stockton landing, or with P anchored off it, and pauses the game. The hold
 * and the storage shed side by side; the purse and the strongbox below. Plan 13 §6:
 * shift-click moves a whole lot, ctrl-click one CU, a plain click picks it for the slider.
 * The footer lets the captain lie at anchor until dawn, dusk or a shift of wind.
 */

type Side = 'in' | 'out';

function Ember() {
  return (
    <span class="ember" title="Hot: taken by crime" aria-label="hot">
      ◆
    </span>
  );
}

function Bar({ used, capacity, label }: { used: number; capacity: number; label: string }) {
  const frac = capacity > 0 ? Math.min(1, used / capacity) : 0;
  return (
    <div class="port-capacity">
      <span>
        {label}{' '}
        <span class="hud-num">
          {used} / {capacity} CU
        </span>
      </span>
      <div class="port-capacity-bar" aria-hidden="true">
        <div style={{ width: `${(frac * 100).toFixed(1)}%` }} />
      </div>
    </div>
  );
}

function Column({
  title,
  rows,
  used,
  capacity,
  side,
  empty,
  onPick,
  testid,
}: {
  title: string;
  rows: StashRow[];
  used: number;
  capacity: number;
  side: Side;
  empty: string;
  onPick(row: StashRow, side: Side, e: MouseEvent): void;
  testid: string;
}) {
  return (
    <section class="stash-column" data-testid={testid}>
      <h3>{title}</h3>
      <Bar used={used} capacity={capacity} label={side === 'in' ? 'Hold' : 'Shed'} />
      {rows.length === 0 ? (
        <p class="port-dim">{empty}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li
              key={`${r.good}-${r.index}`}
              class={r.hot ? 'hot' : ''}
              data-testid={`${testid}-row`}
            >
              <span>
                {r.hot && <Ember />} {r.name}
                {r.contract && <small class="port-dim"> (contract)</small>}
              </span>
              <span class="hud-num">{r.qty} CU</span>
              <button
                type="button"
                class="port-mini"
                data-testid={`${side === 'in' ? 'stash' : 'take'}-${r.index}`}
                title={`${side === 'in' ? 'Stash' : 'Take aboard'} (shift-click: all, ctrl-click: one)`}
                onClick={(e) => onPick(r, side, e)}
              >
                {side === 'in' ? 'Stash →' : '← Take'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MovePanel({
  row,
  side,
  actions,
  onDone,
}: {
  row: StashRow;
  side: Side;
  actions: StashActions;
  onDone(message: string | undefined): void;
}) {
  const [qty, setQty] = useState(row.qty);
  useEffect(() => setQty((q) => Math.max(1, Math.min(q, row.qty))), [row.qty, row.good, side]);
  const n = Math.max(1, Math.min(qty, row.qty));
  return (
    <div class="port-trade" data-testid="stash-panel">
      <div class="port-trade-line">
        <strong>
          {side === 'in' ? 'Stash' : 'Take aboard'} {row.name}
        </strong>
        <input
          type="range"
          min={1}
          max={row.qty}
          step={1}
          value={n}
          data-testid="stash-qty"
          aria-label="Quantity"
          onInput={(e) => setQty(Number((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="hud-num">{n} CU</span>
        <button
          type="button"
          class="menu-button primary"
          data-testid="stash-confirm"
          onClick={() =>
            onDone(side === 'in' ? actions.stash(row.index, n) : actions.take(row.index, n))
          }
        >
          {side === 'in' ? 'Stash' : 'Take'}
        </button>
      </div>
    </div>
  );
}

/** Dollars typed or slid, as whole cents. */
function Cash({
  stash,
  actions,
  setMessage,
}: {
  stash: StashSnapshot;
  actions: StashActions;
  setMessage(m: string | undefined): void;
}) {
  const [dollars, setDollars] = useState(10);
  const cents = Math.max(0, Math.round(dollars * 100));
  if (!stash.strongbox) return null;
  return (
    <section class="stash-cash" data-testid="stash-cash">
      <span>
        Purse{' '}
        <strong class="hud-num" data-testid="stash-purse">
          {formatCents(stash.purseCents)}
        </strong>
      </span>
      <span class="stash-cash-move">
        <span>$</span>
        <input
          type="number"
          min={0}
          step={1}
          value={dollars}
          data-testid="stash-cash-amount"
          aria-label="Dollars"
          onInput={(e) => setDollars(Number((e.currentTarget as HTMLInputElement).value) || 0)}
        />
        <button
          type="button"
          class="port-mini"
          data-testid="stash-cash-in"
          title="Into the strongbox (shift-click: the whole purse)"
          onClick={(e) => setMessage(actions.stashCash(e.shiftKey ? stash.purseCents : cents))}
        >
          Stash →
        </button>
        <button
          type="button"
          class="port-mini"
          data-testid="stash-cash-out"
          title="Into the purse (shift-click: all of it)"
          onClick={(e) => setMessage(actions.takeCash(e.shiftKey ? stash.cashCents : cents))}
        >
          ← Take
        </button>
      </span>
      <span>
        Strongbox{' '}
        <strong class="hud-num" data-testid="stash-strongbox">
          {formatCents(stash.cashCents)}
        </strong>
      </span>
    </section>
  );
}

export function LieButtons({
  refusal,
  lie,
  setMessage,
}: {
  refusal: string | undefined;
  lie(until: LieUntil): string | undefined;
  setMessage(m: string | undefined): void;
}) {
  const choices: [LieUntil, string][] = [
    ['dawn', 'Until dawn'],
    ['dusk', 'Until dusk'],
    ['wind', 'Until the wind shifts'],
  ];
  return (
    <span class="stash-lie" title={refusal}>
      <span class="port-dim">Lie at anchor:</span>
      {choices.map(([id, label]) => (
        <button
          type="button"
          key={id}
          class="menu-button"
          data-testid={`lie-${id}`}
          disabled={!!refusal}
          onClick={() => setMessage(lie(id))}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

export function StashScreen({ stash, actions }: { stash: StashSnapshot; actions: StashActions }) {
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [sel, setSel] = useState<{ good: string; index: number; side: Side } | undefined>();
  const list = sel?.side === 'in' ? stash.hold : stash.stash;
  const row = sel && (list.find((r) => r.index === sel.index && r.good === sel.good) ?? undefined);
  const pick = (r: StashRow, side: Side, e: MouseEvent): void => {
    if (e.shiftKey || e.ctrlKey) {
      const qty = e.ctrlKey ? 1 : r.qty;
      setMessage(side === 'in' ? actions.stash(r.index, qty) : actions.take(r.index, qty));
      setSel(undefined);
      return;
    }
    setSel({ good: r.good, index: r.index, side });
  };
  return (
    <div class="menu-backdrop" data-testid="stash-screen" data-hideout={stash.hideout}>
      <div class="menu port" role="dialog" aria-modal="true" aria-label={stash.siteName}>
        <header class="menu-header">
          <h2>{stash.siteName}</h2>
          <span class="port-purse">{stash.dateText}</span>
        </header>
        <p class="menu-note">{stash.blurb}</p>
        {message && (
          <p class="port-message" role="status" data-testid="stash-message">
            {message}
          </p>
        )}
        <div class="port-body stash-body">
          <Column
            title="Your hold"
            rows={stash.hold}
            used={stash.holdUsed}
            capacity={stash.holdCapacity}
            side="in"
            empty="Empty."
            onPick={pick}
            testid="stash-hold"
          />
          <Column
            title="The storage shed"
            rows={stash.stash}
            used={stash.stashUsed}
            capacity={stash.stashCapacity}
            side="out"
            empty="Nothing stored."
            onPick={pick}
            testid="stash-store"
          />
        </div>
        {row && sel && (
          <MovePanel
            row={row}
            side={sel.side}
            actions={actions}
            onDone={(m) => {
              setMessage(m);
              setSel(undefined);
            }}
          />
        )}
        <Cash stash={stash} actions={actions} setMessage={setMessage} />
        <p class="menu-note">
          What's stored here is safe: it isn't aboard, so it can't be lost with the ship or found in
          a search.
        </p>
        <footer class="menu-footer port-footer">
          <LieButtons refusal={stash.lieRefusal} lie={actions.lie} setMessage={setMessage} />
          <button
            type="button"
            class="menu-button"
            data-testid="stash-cast-off"
            onClick={actions.castOff}
          >
            Cast off (F)
          </button>
          <button
            type="button"
            class="menu-button primary"
            data-testid="stash-close"
            onClick={actions.close}
          >
            Back aboard (Esc)
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Lying at anchor away from a stash (Z): the three choices. */
export function LieDialog({ actions }: { actions: StashActions }) {
  const [message, setMessage] = useState<string | undefined>(undefined);
  return (
    <div class="menu-backdrop" data-testid="lie-dialog">
      <div class="menu lie" role="dialog" aria-modal="true" aria-label="Lie at anchor">
        <header class="menu-header">
          <h2>Lie at anchor</h2>
        </header>
        <p class="menu-note">Let the hours pass here. The lake goes on without you.</p>
        {message && (
          <p class="port-message" role="status">
            {message}
          </p>
        )}
        <footer class="menu-footer port-footer">
          <LieButtons refusal={undefined} lie={actions.lie} setMessage={setMessage} />
          <button
            type="button"
            class="menu-button primary"
            data-testid="lie-close"
            onClick={actions.close}
          >
            Stay (Esc)
          </button>
        </footer>
      </div>
    </div>
  );
}
