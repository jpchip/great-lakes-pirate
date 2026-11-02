import { formatCents } from '../../sim/economy/knowledge';
import { Help } from './Help';
import type { PortActions } from './PortScreen';
import {
  CATEGORY_NAMES,
  type HullOffer,
  type HullStats,
  type UpgradeRow,
  type YardSnapshot,
} from './shipyard-model';

/**
 * The shipyard tab and the chandlery's fittings (plan 10 §12, plan 13 §5; Phase 4 piece
 * G). Kept spare: numbers on the page, explanations in "?" tooltips. Hulls side by side
 * with the trade-in worked out, upgrades by category, repairs. Yard work takes game time,
 * which passes when you confirm; a chandler fits his gear on the spot.
 */

const pct = (v: number): string => `${Math.round(v * 100)}%`;
/** Yard time as a few characters: "12 h", "2 d"; nothing for work done on the spot. */
const hoursText = (h: number): string =>
  h <= 0 ? '' : h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;

function Bar({ label, value, testid }: { label: string; value: number; testid: string }) {
  return (
    <div class="yard-bar" data-testid={testid} data-value={value.toFixed(3)}>
      <span>{label}</span>
      <div class="port-capacity-bar" aria-hidden="true">
        <div style={{ width: `${(Math.min(1, value) * 100).toFixed(1)}%` }} />
      </div>
      <span class="hud-num">{pct(value)}</span>
    </div>
  );
}

/** One line of the numbers that matter; the rest sit in its tooltip. */
function statLine(s: HullStats): string {
  return `${s.speedKn} kn · ${s.cargoCu} CU · ${s.draftM}`;
}

function statDetail(s: HullStats): string {
  return `Hull speed ${s.speedKn} kn, hold ${s.cargoCu} CU, draft ${s.draftM}, hull ${s.hullHp} HP, rigging ${s.riggingHp} HP, sail change ${s.sailChangeS} s`;
}

/** Her condition, numbers and slots: beside the shipyard and fittings. */
export function ShipPanel({ yard }: { yard: YardSnapshot }) {
  return (
    <aside class="port-hold yard-ship" data-testid="yard-ship">
      <h3>{yard.shipName}</h3>
      <Bar label="Hull" value={yard.hull01} testid="yard-hull" />
      <Bar label="Rig" value={yard.rigging01} testid="yard-rigging" />
      <p class="yard-line hud-num" title={statDetail(yard.stats)}>
        {statLine(yard.stats)}
      </p>
      <ul class="yard-slots">
        {yard.slots.map((s) => (
          <li key={s.category}>
            <span>{s.label}</span>
            <span class="hud-num">
              {s.used}/{s.total}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function RepairLine({
  yard,
  actions,
  setMessage,
}: {
  yard: YardSnapshot;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  const what = yard.place === 'shipyard' ? 'Repair hull and rig' : 'Mend rigging';
  if (!yard.repair) return null;
  const time = hoursText(yard.repair.hours);
  return (
    <div class="yard-repair">
      <span>
        {what} <strong class="hud-num">{formatCents(yard.repair.totalCents)}</strong>
        {time && <small class="port-dim"> · {time}</small>}
      </span>
      <button
        type="button"
        class="port-mini"
        data-testid={`repair-${yard.place}`}
        disabled={!yard.repair.affordable}
        onClick={() => setMessage(actions.repair(yard.place) ?? 'Repaired.')}
      >
        Repair
      </button>
    </div>
  );
}

function UpgradeTable({
  rows,
  place,
  actions,
  setMessage,
}: {
  rows: UpgradeRow[];
  place: 'shipyard' | 'chandlery';
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  let category = '';
  const timed = place === 'shipyard';
  return (
    <table class="port-table" data-testid={`upgrades-${place}`}>
      <tbody>
        {rows.map((u) => {
          const header =
            u.category !== category ? (
              <tr class="port-category" key={`cat-${u.category}`}>
                <td colSpan={timed ? 4 : 3}>{CATEGORY_NAMES[u.category]}</td>
              </tr>
            ) : null;
          category = u.category;
          return [
            header,
            <tr
              key={u.id}
              class={`port-row${u.fitted ? ' selected' : ''}`}
              data-testid={`upgrade-row-${u.id}`}
            >
              <td>
                {u.name}
                <Help text={u.blurb} />
                {u.transferable && (
                  <span
                    class="port-icon"
                    title="Moves to a new hull"
                    aria-label="moves to a new hull"
                  >
                    ⇄
                  </span>
                )}
              </td>
              <td class="num hud-num">{formatCents(u.priceCents)}</td>
              {timed && (
                <td class="num hud-num port-dim" title="Game time in the yard">
                  {hoursText(u.hours)}
                </td>
              )}
              <td class="port-actions">
                {u.fitted ? (
                  <button
                    type="button"
                    class="port-mini"
                    data-testid={`unfit-${u.id}`}
                    title={`Take it out: ${formatCents(u.refundCents)} back`}
                    onClick={() => setMessage(actions.unfit(u.id, place) ?? `${u.name} taken out.`)}
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    class="port-mini"
                    data-testid={`fit-${u.id}`}
                    disabled={!!u.refusal}
                    title={u.refusal ?? 'Fit it'}
                    onClick={() => setMessage(actions.fit(u.id, place) ?? `${u.name} fitted.`)}
                  >
                    {u.refusal === 'No free slot' ? 'No slot' : 'Fit'}
                  </button>
                )}
              </td>
            </tr>,
          ];
        })}
      </tbody>
    </table>
  );
}

function HullCard({
  hull,
  actions,
  setMessage,
}: {
  hull: HullOffer;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  const extras = [
    hull.movingNames.length > 0 ? `Comes across: ${hull.movingNames.join(', ')}.` : '',
    hull.overflowText ? `${hull.overflowText}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div class={`yard-hull${hull.current ? ' current' : ''}`} data-testid={`hull-${hull.classId}`}>
      <h4>
        {hull.name} <small class="port-dim">T{hull.tier}</small>
        <Help text={statDetail(hull.stats)} />
        {extras && <Help text={extras} label="!" />}
      </h4>
      <p class="yard-line hud-num">{statLine(hull.stats)}</p>
      {hull.current ? (
        <p class="port-dim">Yours</p>
      ) : (
        <div class="yard-buy">
          <span
            title={`Price ${formatCents(hull.priceCents)}, your ship in trade −${formatCents(hull.tradeInCents)}`}
          >
            {hull.netCents >= 0 ? 'Pay' : 'Receive'}{' '}
            <strong class="hud-num" data-testid={`hull-net-${hull.classId}`}>
              {formatCents(Math.abs(hull.netCents))}
            </strong>
          </span>
          <button
            type="button"
            class="port-mini primary"
            data-testid={`buy-hull-${hull.classId}`}
            disabled={!!hull.refusal}
            title={hull.refusal}
            onClick={() =>
              setMessage(actions.buyHull(hull.classId) ?? `She's yours: the ${hull.name}.`)
            }
          >
            Buy
          </button>
        </div>
      )}
    </div>
  );
}

export function Shipyard({
  yard,
  actions,
  setMessage,
}: {
  yard: YardSnapshot;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  return (
    <div class="port-chandlery yard" data-testid="shipyard">
      <RepairLine yard={yard} actions={actions} setMessage={setMessage} />
      <h3>
        Hulls
        <Help text="One ship at a time: a new hull trades yours in at half her price by her condition, plus a quarter of the value of gear left aboard. Instruments and the anchor come across if she has slots; cargo that won't fit is sold here at 80%." />
      </h3>
      <div class="yard-hulls">
        {yard.hulls.map((h) => (
          <HullCard key={h.classId} hull={h} actions={actions} setMessage={setMessage} />
        ))}
      </div>
      <h3>Upgrades</h3>
      <UpgradeTable
        rows={yard.upgrades}
        place="shipyard"
        actions={actions}
        setMessage={setMessage}
      />
    </div>
  );
}

/** The chandler's gear, fitted on the spot, and his rigging repair. */
export function Fittings({
  yard,
  actions,
  setMessage,
}: {
  yard: YardSnapshot;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  return (
    <div class="yard-fittings" data-testid="fittings">
      <RepairLine yard={yard} actions={actions} setMessage={setMessage} />
      <h3>
        Fittings
        <Help text="Instruments and gear, fitted while you wait." />
      </h3>
      <UpgradeTable
        rows={yard.upgrades}
        place="chandlery"
        actions={actions}
        setMessage={setMessage}
      />
    </div>
  );
}
