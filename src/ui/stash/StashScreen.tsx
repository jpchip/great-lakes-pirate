import { useEffect, useState } from 'preact/hooks';
import { formatCents } from '../../sim/economy/knowledge';
import { LIE_CHOICES, type LieUntil } from '../../sim/hideouts/lie-at-anchor';
import type { StashActions } from '../../gameplay/stash';
import type {
  InputRow,
  RecipeRow,
  SlipwaySnapshot,
  StashRow,
  StashSnapshot,
  StationRow,
  WorkshopSnapshot,
} from './model';

/**
 * The stash screen (plan 13 §5 "Storage transfer", plan 09 §3; Phase 4 piece E): opens
 * alongside the Stockton landing, or with P anchored off it, and pauses the game. The hold
 * and the storage shed side by side; the purse and the strongbox below. Plan 13 §6:
 * shift-click moves a whole lot, ctrl-click one CU, a plain click picks it for the slider.
 * The footer lets the captain lie at anchor an hour, a watch, or until dawn, dusk or a shift
 * of wind.
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
  onRecrate,
}: {
  title: string;
  rows: StashRow[];
  used: number;
  capacity: number;
  side: Side;
  empty: string;
  onPick(row: StashRow, side: Side, e: MouseEvent): void;
  testid: string;
  onRecrate?: ((row: StashRow) => void) | undefined;
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
                {r.recrated && <small class="port-dim"> (re-crated)</small>}
              </span>
              <span class="hud-num">{r.qty} CU</span>
              <span class="stash-row-buttons">
                {onRecrate && r.recrate > 0 && (
                  <button
                    type="button"
                    class="port-mini"
                    data-testid={`recrate-${r.index}`}
                    title={`Re-crate ${r.recrate} CU in plain crates at the cooperage: the company's marks come off`}
                    onClick={() => onRecrate(r)}
                  >
                    Re-crate
                  </button>
                )}
                <button
                  type="button"
                  class="port-mini"
                  data-testid={`${side === 'in' ? 'stash' : 'take'}-${r.index}`}
                  title={`${side === 'in' ? 'Stash' : 'Take aboard'} (shift-click: all, ctrl-click: one)`}
                  onClick={(e) => onPick(r, side, e)}
                >
                  {side === 'in' ? 'Stash →' : '← Take'}
                </button>
              </span>
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

function Recipe({
  recipe,
  passive,
  loadText,
  actions,
  setMessage,
}: {
  recipe: RecipeRow;
  passive: boolean;
  loadText: string;
  actions: StashActions;
  setMessage(m: string | undefined): void;
}) {
  const [n, setN] = useState(1);
  const batches = Math.max(1, Math.min(n, Math.max(1, recipe.max)));
  if (recipe.recrate) {
    return (
      <li class="craft-recipe" data-testid={`recipe-${recipe.id}`}>
        <div class="craft-recipe-head">
          <strong>{recipe.name}</strong>
          <span class="port-dim">{recipe.timeText} a load</span>
        </div>
        <p class="craft-blurb">{recipe.blurb}</p>
        <p class="craft-inputs port-dim">
          A crate a load ({recipe.inputs[0]?.have ?? 0} here). Use Re-crate on a stolen lot in the
          shed.
        </p>
      </li>
    );
  }
  return (
    <li
      class={`craft-recipe${recipe.max > 0 ? '' : ' unable'}`}
      data-testid={`recipe-${recipe.id}`}
    >
      <div class="craft-recipe-head">
        <strong>{recipe.name}</strong>
        <span class="port-dim">{passive ? `${recipe.timeText} a batch` : recipe.timeText}</span>
      </div>
      <p class="craft-blurb">{recipe.blurb}</p>
      <p class="craft-inputs">
        {recipe.inputs.map((i) => (
          <span key={i.name} class={i.have >= i.need ? 'have' : 'short'}>
            {i.need}
            {i.unit ? ` ${i.unit}` : ' ×'} {i.name} <small class="hud-num">({i.have})</small>
          </span>
        ))}
        {recipe.water && <span class="have">water</span>}
        <span class="craft-arrow">→</span>
        <span class="craft-out">{recipe.outputText}</span>
      </p>
      <div class="craft-make">
        {recipe.max > 1 && (
          <input
            type="number"
            min={1}
            max={recipe.max}
            value={batches}
            aria-label="Batches"
            data-testid={`batches-${recipe.id}`}
            onInput={(e) => setN(Number((e.currentTarget as HTMLInputElement).value) || 1)}
          />
        )}
        <button
          type="button"
          class="menu-button"
          data-testid={`make-${recipe.id}`}
          disabled={recipe.max <= 0}
          title={recipe.refusal}
          onClick={() => setMessage(actions.craft(recipe.id, batches))}
        >
          {passive ? loadText : 'Make'}
        </button>
        {recipe.max <= 0 && recipe.refusal && <small class="port-dim">{recipe.refusal}</small>}
      </div>
    </li>
  );
}

function Station({
  station,
  actions,
  setMessage,
}: {
  station: StationRow;
  actions: StashActions;
  setMessage(m: string | undefined): void;
}) {
  return (
    <section class="craft-station" data-testid={`station-${station.id}`}>
      <p class="port-dim craft-blurb">{station.blurb}</p>
      {station.passive && (
        <div class="craft-queue" data-testid="still-queue">
          <strong>
            In {station.vessel} ({station.queue.length} / {station.queueMax})
          </strong>
          {station.queue.length === 0 ? (
            <span class="port-dim"> Nothing loaded.</span>
          ) : (
            <ul>
              {station.queue.map((b, i) => (
                <li key={i}>
                  {b.name}: {b.readyText}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ul class="craft-recipes">
        {station.recipes.map((r) => (
          <Recipe
            key={r.id}
            recipe={r}
            passive={station.passive}
            loadText={station.loadText}
            actions={actions}
            setMessage={setMessage}
          />
        ))}
      </ul>
    </section>
  );
}

/** The workshop (plan 09 §7, plan 13 §12; Phase 8 piece E): the stations built here. */
function Workshop({
  workshop,
  actions,
  setMessage,
}: {
  workshop: WorkshopSnapshot;
  actions: StashActions;
  setMessage(m: string | undefined): void;
}) {
  const [tab, setTab] = useState<string | undefined>(undefined);
  const shown = workshop.stations.find((s) => s.id === tab) ?? workshop.stations[0];
  return (
    <div class="craft" data-testid="workshop">
      {workshop.stations.length === 0 ? (
        <p class="port-dim">
          No workstations here yet. Build a workbench, smithy, cooperage, distillery, sail loft,
          smokehouse, powder room or cartography table, and what you can make with them shows here.
        </p>
      ) : (
        <div class="craft-body">
          <nav class="craft-stations">
            {workshop.stations.map((s) => (
              <button
                type="button"
                key={s.id}
                class={`menu-tab${shown?.id === s.id ? ' active' : ''}`}
                data-testid={`station-tab-${s.id}`}
                onClick={() => setTab(s.id)}
              >
                {s.name}
                {s.passive && s.queue.length > 0 && <small> ({s.queue.length})</small>}
              </button>
            ))}
          </nav>
          {shown && <Station station={shown} actions={actions} setMessage={setMessage} />}
        </div>
      )}
      <section class="craft-things" data-testid="workshop-things">
        <h3>Made and kept here</h3>
        {workshop.things.length === 0 ? (
          <p class="port-dim">Nothing yet.</p>
        ) : (
          <ul>
            {workshop.things.map((t) => (
              <li key={t.id} data-testid="thing-row" data-thing={t.id}>
                <span>{t.name}</span>
                <span class="hud-num">{t.qty}</span>
                {t.store ? (
                  <button
                    type="button"
                    class="port-mini"
                    data-testid={`take-thing-${t.id}`}
                    title={`Into the lockers (${t.aboard} aboard); shift-click: one`}
                    onClick={(e) => setMessage(actions.takeThing(t.id, e.shiftKey ? 1 : t.qty))}
                  >
                    ← Aboard
                  </button>
                ) : (
                  <small class="port-dim">
                    {t.id.startsWith('upgrade.') ? 'for the slipway' : 'kept here'}
                  </small>
                )}
              </li>
            ))}
          </ul>
        )}
        {workshop.lockers.length > 0 && (
          <p class="port-dim craft-lockers">
            In the lockers:{' '}
            {workshop.lockers.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ', '}
                {t.qty} {t.name}{' '}
                <button
                  type="button"
                  class="port-mini"
                  data-testid={`leave-thing-${t.id}`}
                  title="Leave one here"
                  onClick={() => setMessage(actions.stashThing(t.id, 1))}
                >
                  leave one
                </button>
              </span>
            ))}
          </p>
        )}
      </section>
    </div>
  );
}

function Inputs({ inputs }: { inputs: InputRow[] }) {
  return (
    <>
      {inputs.map((i) => (
        <span key={i.name} class={i.have >= i.need ? 'have' : 'short'}>
          {i.need} {i.unit} {i.name} <small class="hud-num">({i.have})</small>
        </span>
      ))}
    </>
  );
}

/**
 * The slipway (plan 09 §7.4, plan 10 §8–9; Phase 8 piece G): haul her out for full repairs
 * and to fit what was made here, or, shipless, lay down a new schooner.
 */
function Slipway({
  slipway: s,
  actions,
  setMessage,
}: {
  slipway: SlipwaySnapshot;
  actions: StashActions;
  setMessage(m: string | undefined): void;
}) {
  if (!s.built) {
    return (
      <div class="craft slipway" data-testid="slipway">
        <p class="port-dim">
          No slipway here yet. Lay one down in build mode (B, under Water) where the shore runs
          straight down a steady slope into 1.5 to 4 m of water. On the ways you can make her sound
          from your own materials, fit what you make at the bench and the forge, and, if you ever
          lose her, build another.
        </p>
      </div>
    );
  }
  if (s.shipless) {
    const n = s.newShip;
    return (
      <div class="craft slipway" data-testid="slipway" data-shipless="true">
        <p class="craft-blurb">
          You have no ship. With the materials in the shed you can lay down a new{' '}
          {n.className.toLowerCase()} on the ways and launch her yourself: she comes bare and sound,
          and the gear kept here can go into her at once.
        </p>
        <section class="craft-recipe" data-testid="slipway-new-ship">
          <div class="craft-recipe-head">
            <strong>Build a {n.className.toLowerCase()}</strong>
            <span class="port-dim">{n.timeText}, alone</span>
          </div>
          <p class="craft-inputs">
            <Inputs inputs={n.inputs} />
            <span class="craft-arrow">→</span>
            <span class="craft-out">the {s.shipName}, launched</span>
          </p>
          <div class="craft-make">
            <button
              type="button"
              class="menu-button primary"
              data-testid="slipway-build-ship"
              disabled={!!n.refusal}
              title={n.refusal}
              onClick={() => setMessage(actions.buildShip())}
            >
              Lay her down
            </button>
            {n.refusal && <small class="port-dim">{n.refusal}</small>}
          </div>
        </section>
        <p class="port-dim craft-blurb">
          Or give it up and make your way to the nearest yard, which will let you have a worn hull
          on credit.{' '}
          <button
            type="button"
            class="port-mini"
            data-testid="slipway-to-yard"
            onClick={() => actions.toYard()}
          >
            Make for the yard
          </button>
        </p>
      </div>
    );
  }
  const r = s.repair;
  return (
    <div class="craft slipway" data-testid="slipway" data-here={s.shipHere ? 'true' : 'false'}>
      <p class="craft-blurb">
        The {s.shipName}, {s.className.toLowerCase()}: hull{' '}
        <strong class="hud-num" data-testid="slipway-hull">
          {s.hull}%
        </strong>
        , rigging{' '}
        <strong class="hud-num" data-testid="slipway-rigging">
          {s.rigging}%
        </strong>
        .
        {!s.shipHere &&
          ' She has to be moored here, in the anchorage or alongside, to haul her out.'}
      </p>
      {r && (
        <section class="craft-recipe" data-testid="slipway-repair">
          <div class="craft-recipe-head">
            <strong>Haul her out and make her sound</strong>
            {r.timeText && <span class="port-dim">{r.timeText}</span>}
          </div>
          {r.inputs.length > 0 && (
            <p class="craft-inputs">
              <Inputs inputs={r.inputs} />
              <span class="craft-arrow">→</span>
              <span class="craft-out">hull and rigging 100%</span>
            </p>
          )}
          <div class="craft-make">
            <button
              type="button"
              class="menu-button"
              data-testid="slipway-repair-go"
              disabled={!!r.refusal}
              title={r.refusal}
              onClick={() => setMessage(actions.slipwayRepair())}
            >
              Repair
            </button>
            {r.refusal && <small class="port-dim">{r.refusal}</small>}
          </div>
        </section>
      )}
      <section class="craft-things" data-testid="slipway-upgrades">
        <h3>Fittings made here</h3>
        {s.upgrades.length === 0 ? (
          <p class="port-dim">
            None waiting. Repair stores come from the workbench, improved carriages from the smithy,
            sails and muffled blocks from the sail loft, and corrected charts from the cartography
            table.
          </p>
        ) : (
          <ul>
            {s.upgrades.map((u) => (
              <li key={u.id} data-testid="slipway-upgrade" data-upgrade={u.id}>
                <span title={u.blurb}>
                  {u.name} {u.qty > 1 && <small class="hud-num">×{u.qty}</small>}
                </span>
                <span class="port-dim">{u.timeText}</span>
                <button
                  type="button"
                  class="port-mini"
                  data-testid={`slipway-fit-${u.id}`}
                  disabled={!!u.refusal}
                  title={u.refusal ?? u.blurb}
                  onClick={() => setMessage(actions.slipwayInstall(u.id))}
                >
                  Fit
                </button>
                {u.refusal && <small class="port-dim">{u.refusal}</small>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function LieButtons({
  refusal,
  lie,
  setMessage,
  label,
}: {
  refusal: string | undefined;
  lie(until: LieUntil): string | undefined;
  setMessage(m: string | undefined): void;
  /** A word before the buttons, e.g. "Wait". */
  label?: string | undefined;
}) {
  return (
    <span class="stash-lie" title={refusal} data-testid="lie-buttons">
      {label && <span class="stash-lie-label">{label}</span>}
      {LIE_CHOICES.map(([id, label]) => (
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
  const [view, setView] = useState<'storage' | 'workshop' | 'slipway'>(stash.tab ?? 'storage');
  // Opened again on a tab (F at the slipway with the screen up): follow it.
  useEffect(() => {
    if (stash.tab) setView(stash.tab);
  }, [stash.tab]);
  const shipless = stash.slipway.shipless;
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
        </header>
        <nav class="menu-tabs">
          {(
            [
              ['storage', 'Storage'],
              ['workshop', 'Workshop'],
              ['slipway', 'Slipway'],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              key={id}
              class={`menu-tab${view === id ? ' active' : ''}`}
              data-testid={`stash-tab-${id}`}
              onClick={() => {
                setView(id);
                setMessage(undefined);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        {message && (
          <p class="port-message" role="status" data-testid="stash-message">
            {message}
          </p>
        )}
        {view === 'workshop' && (
          <Workshop workshop={stash.workshop} actions={actions} setMessage={setMessage} />
        )}
        {view === 'slipway' && (
          <Slipway slipway={stash.slipway} actions={actions} setMessage={setMessage} />
        )}
        {view === 'storage' && (
          <div class="port-body stash-body">
            <Column
              title="Hold"
              rows={stash.hold}
              used={stash.holdUsed}
              capacity={stash.holdCapacity}
              side="in"
              empty="Empty."
              onPick={pick}
              testid="stash-hold"
            />
            <Column
              title="Shed"
              rows={stash.stash}
              used={stash.stashUsed}
              capacity={stash.stashCapacity}
              side="out"
              empty="Nothing stored."
              onPick={pick}
              testid="stash-store"
              onRecrate={(r) => setMessage(actions.craft('recipe.recrate', r.recrate, r.index))}
            />
          </div>
        )}
        {view === 'storage' && row && sel && (
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
        {view === 'storage' && <Cash stash={stash} actions={actions} setMessage={setMessage} />}
        <footer class="menu-footer port-footer">
          {!shipless && (
            <LieButtons refusal={stash.lieRefusal} lie={actions.lie} setMessage={setMessage} />
          )}
          {!shipless && (
            <button
              type="button"
              class="menu-button"
              data-testid="stash-cast-off"
              onClick={actions.castOff}
            >
              Cast off (F)
            </button>
          )}
          <button
            type="button"
            class="menu-button primary"
            data-testid="stash-close"
            onClick={actions.close}
          >
            {shipless ? 'Close (Esc)' : 'Back aboard (Esc)'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Lying at anchor or alongside away from a stash (Z): the choices. */
export function LieDialog({
  actions,
  docked = false,
}: {
  actions: StashActions;
  /** Alongside a pier rather than at anchor: the title says so. */
  docked?: boolean | undefined;
}) {
  const [message, setMessage] = useState<string | undefined>(undefined);
  const title = docked ? 'Lie alongside' : 'Lie at anchor';
  return (
    <div class="menu-backdrop" data-testid="lie-dialog">
      <div class="menu lie" role="dialog" aria-modal="true" aria-label={title}>
        <header class="menu-header">
          <h2>{title}</h2>
          <p class="port-dim">
            Let the clock run on: the markets, the traffic and the weather go on without you.
          </p>
        </header>
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
