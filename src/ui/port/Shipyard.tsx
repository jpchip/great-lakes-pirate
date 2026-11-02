import { formatCents } from '../../sim/economy/knowledge';
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
 * G). Hulls side by side with the trade-in worked out, upgrades by category with the
 * slots they take, and repairs. Yard work takes game time, which passes when you confirm
 * (the screen says how long); a chandler fits his gear on the spot.
 */

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const hoursText = (h: number): string =>
  h <= 0 ? 'on the spot' : h < 24 ? `${h} h in the yard` : `${Math.round(h / 24)} d in the yard`;

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

function Stats({ stats }: { stats: HullStats }) {
  return (
    <dl class="yard-stats">
      <dt>Hull speed</dt>
      <dd class="hud-num">{stats.speedKn} kn</dd>
      <dt>Hold</dt>
      <dd class="hud-num">{stats.cargoCu} CU</dd>
      <dt>Draft</dt>
      <dd class="hud-num">{stats.draftM}</dd>
      <dt>Hull / rig</dt>
      <dd class="hud-num">
        {stats.hullHp} / {stats.riggingHp}
      </dd>
      <dt>Sail change</dt>
      <dd class="hud-num">{stats.sailChangeS} s</dd>
    </dl>
  );
}

/** Her name, class, condition and slots: beside the shipyard and fittings. */
export function ShipPanel({ yard }: { yard: YardSnapshot }) {
  return (
    <aside class="port-hold yard-ship" data-testid="yard-ship">
      <h3>{yard.shipName}</h3>
      <p class="port-dim">{yard.className}</p>
      <Bar label="Hull" value={yard.hull01} testid="yard-hull" />
      <Bar label="Rig" value={yard.rigging01} testid="yard-rigging" />
      <Stats stats={yard.stats} />
      <h3>Slots</h3>
      <ul>
        {yard.slots.map((s) => (
          <li key={s.category}>
            <span>{s.label}</span>
            <span class="hud-num">
              {s.used} / {s.total}
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
  const what = yard.place === 'shipyard' ? 'Hull and rigging' : 'Rigging';
  if (!yard.repair)
    return (
      <p class="port-dim">
        {what}: sound, nothing for the {yard.place === 'shipyard' ? 'yard' : 'chandler'} to do.
      </p>
    );
  return (
    <div class="yard-repair">
      <span>
        {what} made sound: <strong class="hud-num">{formatCents(yard.repair.totalCents)}</strong>,{' '}
        {hoursText(yard.repair.hours)}
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
  return (
    <table class="port-table" data-testid={`upgrades-${place}`}>
      <thead>
        <tr>
          <th>Upgrade</th>
          <th class="num">Price</th>
          <th>Work</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((u) => {
          const header =
            u.category !== category ? (
              <tr class="port-category" key={`cat-${u.category}`}>
                <td colSpan={4}>{CATEGORY_NAMES[u.category]}</td>
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
                {u.transferable && <small class="port-role"> moves to a new hull</small>}
                <br />
                <small class="port-dim">{u.blurb}</small>
              </td>
              <td class="num hud-num">{formatCents(u.priceCents)}</td>
              <td class="yard-work">
                <small>{hoursText(u.hours)}</small>
              </td>
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
  return (
    <div class={`yard-hull${hull.current ? ' current' : ''}`} data-testid={`hull-${hull.classId}`}>
      <h4>
        {hull.name} <small class="port-dim">T{hull.tier}</small>
      </h4>
      <Stats stats={hull.stats} />
      {hull.current ? (
        <p class="port-dim">You sail her now.</p>
      ) : (
        <>
          <table class="yard-sum">
            <tbody>
              <tr>
                <td>Price</td>
                <td class="num hud-num">{formatCents(hull.priceCents)}</td>
              </tr>
              <tr>
                <td>Your ship in trade</td>
                <td class="num hud-num">−{formatCents(hull.tradeInCents)}</td>
              </tr>
              <tr class="yard-net">
                <td>{hull.netCents >= 0 ? 'To pay' : 'The yard pays you'}</td>
                <td class="num hud-num" data-testid={`hull-net-${hull.classId}`}>
                  {formatCents(Math.abs(hull.netCents))}
                </td>
              </tr>
            </tbody>
          </table>
          {hull.movingNames.length > 0 && (
            <p class="port-dim">Comes across: {hull.movingNames.join(', ')}.</p>
          )}
          {hull.overflowText && <p class="port-dim">{hull.overflowText}.</p>}
          <button
            type="button"
            class="menu-button primary"
            data-testid={`buy-hull-${hull.classId}`}
            disabled={!!hull.refusal}
            title={hull.refusal}
            onClick={() =>
              setMessage(actions.buyHull(hull.classId) ?? `She's yours: the ${hull.name}.`)
            }
          >
            Buy her
          </button>
          {hull.refusal && <small class="port-dim"> {hull.refusal}</small>}
        </>
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
      <h3>Repairs</h3>
      <RepairLine yard={yard} actions={actions} setMessage={setMessage} />
      <h3>Hulls</h3>
      <p class="menu-note">
        One ship at a time: buying a hull trades in yours at half her price by her condition, and a
        quarter for the gear left aboard. Instruments and the anchor come across if she has the
        slots.
      </p>
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
      <h3>Rigging repair</h3>
      <RepairLine yard={yard} actions={actions} setMessage={setMessage} />
      <h3>Fittings</h3>
      <p class="menu-note">
        Ship: hull {pct(yard.hull01)}, rig {pct(yard.rigging01)}. Instruments and gear, fitted while
        you wait.
      </p>
      <UpgradeTable
        rows={yard.upgrades}
        place="chandlery"
        actions={actions}
        setMessage={setMessage}
      />
    </div>
  );
}
