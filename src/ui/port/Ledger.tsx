import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { formatCents } from '../../sim/economy/knowledge';
import {
  CONTRACT_OUTCOME_WORD,
  type LedgerContractRow,
  type LedgerPrice,
  type LedgerSnapshot,
  type LedgerStandingRow,
  type OfferRow,
  type RumorRow,
} from './model';

/**
 * The ledger (plan 05 §12; journal v1, plan 13 §5): the prices you've seen with their
 * dates, by port or by good, then contracts, rumors and Standing. It's a tab on the port
 * screen and the journal at the helm (J). Stale prices are fog gray and say how old they
 * are, so color is never the only signal (plan 13 §2.2).
 */

type LedgerTab = 'hold' | 'byPort' | 'byGood' | 'contracts' | 'rumors' | 'standing';

const TABS: [LedgerTab, string][] = [
  ['hold', 'Hold'],
  ['byPort', 'Prices by port'],
  ['byGood', 'Prices by good'],
  ['contracts', 'Contracts'],
  ['rumors', 'Rumors'],
  ['standing', 'Standing'],
];

/** One rumor: what was said, who said it and how far to trust it. */
export function RumorItem({ r, showWhere = false }: { r: RumorRow; showWhere?: boolean }) {
  return (
    <li class={`rumor${r.stale ? ' stale' : ''}`} data-testid="rumor">
      <span class="rumor-kind">{r.kind}</span> “{r.text}”
      <br />
      <small class="port-dim">
        {r.from}
        {showWhere ? `, ${r.where}` : ''}, {r.age}
        {r.stale ? ' · past' : ''}
      </small>
    </li>
  );
}

/** Marks a price heard from a rumor or a hail rather than seen. */
function Heard({ p }: { p: LedgerPrice }) {
  return p.heard ? (
    <small class="port-dim" title="Heard, not seen">
      {' '}
      (heard)
    </small>
  ) : null;
}

function Empty({ text }: { text: string }) {
  return <p class="ledger-empty">{text}</p>;
}

function StandingBar({
  row,
  ticks,
}: {
  row: LedgerStandingRow;
  ticks: { value: number; label: string }[];
}) {
  const value = row.burned ? 0 : row.value;
  return (
    <div
      class={`standing-bar${row.burned ? ' burned' : ''}`}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${row.name}, standing ${value}`}
    >
      {ticks.map((t) => (
        <span
          key={t.value}
          class={`standing-tick${value >= t.value ? ' passed' : ''}`}
          style={{ left: `${t.value}%` }}
          title={`${t.label} at ${t.value}`}
        />
      ))}
      {!row.burned && <span class="standing-fill" style={{ width: `${value}%` }} />}
      {row.burned && <span class="standing-burned-label">Burned</span>}
    </div>
  );
}

function StandingRow({
  row,
  ticks,
}: {
  row: LedgerStandingRow;
  ticks: { value: number; label: string }[];
}) {
  const detail =
    row.burned && row.kind === 'company'
      ? 'You stole their cargo'
      : [row.perks.join(' · '), row.next].filter(Boolean).join(' · ');
  return (
    <div
      class={`standing-row${row.burned ? ' burned' : ''}`}
      data-testid="ledger-standing-row"
      data-standing-id={row.id}
    >
      <span class="standing-name">
        {row.name}
        {row.fence && (
          <span class="standing-tag port-mini" data-testid="ledger-receiver-tag">
            fence
          </span>
        )}
      </span>
      <StandingBar row={row} ticks={ticks} />
      <span class="standing-num hud-num">{row.value}</span>
      <span class="standing-word">{row.word}</span>
      {detail ? <small class="standing-detail port-dim">{detail}</small> : null}
    </div>
  );
}

function StandingGroup({
  title,
  rows,
  ticks,
}: {
  title: string;
  rows: LedgerStandingRow[];
  ticks: { value: number; label: string }[];
}) {
  if (!rows.length) return null;
  return (
    <section class="standing-group">
      <h4>{title}</h4>
      {rows.map((row) => (
        <StandingRow key={row.id} row={row} ticks={ticks} />
      ))}
    </section>
  );
}

function Standing({ ledger }: { ledger: LedgerSnapshot }) {
  const ports = ledger.standing.filter((s) => s.kind === 'port');
  const companies = ledger.standing.filter((s) => s.kind === 'company');
  if (!ports.length && !companies.length) {
    return <Empty text="No standing with any port or company yet." />;
  }
  return (
    <div class="standing" data-testid="ledger-standing">
      <StandingGroup title="Ports" rows={ports} ticks={ledger.standingTicks.port} />
      <StandingGroup title="Companies" rows={companies} ticks={ledger.standingTicks.company} />
    </div>
  );
}

/** What's aboard: each stack, what it cost, and where the contract cargo is bound. */
function Hold({ ledger }: { ledger: LedgerSnapshot }) {
  const { rows, usedCu, capacity } = ledger.hold;
  return (
    <div data-testid="ledger-hold">
      <p>
        Hold {usedCu} / {capacity} CU
      </p>
      {rows.length === 0 ? (
        <Empty text="The hold is empty." />
      ) : (
        <table class="ledger-table">
          <thead>
            <tr>
              <th>Cargo</th>
              <th class="num">CU</th>
              <th class="num" title="What a CU cost you on average">
                Paid each
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.name}-${i}`} class={r.hot ? 'hot' : ''} data-testid="ledger-hold-row">
                <td>
                  {r.name}
                  {r.hot && <small class="port-dim"> (hot)</small>}
                  {r.contract && (
                    <small class="port-dim">
                      {' '}
                      (contract{r.contractTo ? ` to ${r.contractTo}` : ''})
                    </small>
                  )}
                </td>
                <td class="num hud-num">{r.qty}</td>
                <td class="num hud-num">
                  {r.paidCents === undefined ? '—' : formatCents(r.paidCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ByPort({ ledger, here }: { ledger: LedgerSnapshot; here: string | undefined }) {
  const [port, setPort] = useState<string | undefined>(undefined);
  const first = ledger.ports.find((p) => p.id !== here) ?? ledger.ports[0];
  const chosen = ledger.ports.find((p) => p.id === port) ?? first;
  if (!chosen) return <Empty text="No prices written down yet. Visit a market." />;
  const book = ledger.prices[chosen.id] ?? {};
  return (
    <div>
      <label class="menu-row">
        <span>Port</span>
        <select
          data-testid="ledger-port"
          value={chosen.id}
          onChange={(e) => setPort((e.currentTarget as HTMLSelectElement).value)}
        >
          {ledger.ports.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {p.age}
            </option>
          ))}
        </select>
      </label>
      <p class={`ledger-seen${chosen.stale ? ' stale' : ''}`}>
        Seen the {chosen.seenText.replace(/^Wk/, 'week')} ({chosen.age})
      </p>
      <table class="ledger-table">
        <thead>
          <tr>
            <th>Good</th>
            <th class="num">They ask</th>
            <th class="num">They pay</th>
          </tr>
        </thead>
        <tbody>
          {ledger.goods
            .filter((g) => book[g.id])
            .map((g) => {
              const p = book[g.id];
              if (!p) return null;
              return (
                <tr key={g.id} class={p.stale ? 'stale' : ''}>
                  <td>
                    {g.name}
                    <Heard p={p} />
                  </td>
                  <td class="num">{formatCents(p.buyCents)}</td>
                  <td class="num">{formatCents(p.sellCents)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

const KIND_LABEL: Record<OfferRow['kind'], string | undefined> = {
  freight: undefined,
  rush: 'Rush',
  mail: 'Mail',
  fragile: 'Fragile',
};

const ACTIVE_STATUS_WORD: Record<'active' | 'late' | 'failed', string> = {
  active: '',
  late: 'late: half pay',
  failed: 'Failed: hand the cargo back at a freight agent',
};

function activeDetail(c: LedgerContractRow): string {
  if (c.status === 'failed') return ACTIVE_STATUS_WORD.failed;
  const bits = [c.company, c.dueShort].filter(Boolean);
  const tail = c.status === 'late' ? ACTIVE_STATUS_WORD.late : '';
  if (tail) bits.push(tail);
  return bits.join(' · ');
}

function Contracts({ ledger }: { ledger: LedgerSnapshot }) {
  const active = ledger.contracts.filter((c) => !c.done);
  const past = ledger.contracts.filter((c) => c.done);
  if (!active.length && !past.length) {
    return <Empty text="No contracts yet. A port's freight agent has them." />;
  }
  return (
    <div data-testid="ledger-contracts">
      {active.length > 0 && (
        <section class="ledger-section" data-testid="ledger-contracts-active">
          <h4>In hand</h4>
          <ul class="freight-list">
            {active.map((c) => (
              <li
                key={c.id}
                class={`freight-card ledger-contract-card${c.status === 'late' ? ' late' : ''}${c.status === 'failed' ? ' failed' : ''}`}
                data-testid="ledger-contract-row"
                data-contract-id={c.id}
                title={c.status === 'failed' ? undefined : c.dueText}
              >
                <div class="freight-main">
                  <span class="freight-route">
                    {KIND_LABEL[c.kind] && <span class="port-kind">{KIND_LABEL[c.kind]} </span>}
                    {c.qty} CU {c.cargo}{' '}
                    <span class="port-dim">
                      {c.fromName} → {c.toName}
                    </span>
                  </span>
                  <small class="port-dim">{activeDetail(c)}</small>
                </div>
                <strong class="freight-pay hud-num">
                  {c.status === 'failed' ? '—' : formatCents(c.payCents)}
                </strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      {past.length > 0 && (
        <section class="ledger-section" data-testid="ledger-contracts-history">
          <h4>Past contracts</h4>
          <table class="ledger-table">
            <thead>
              <tr>
                <th>Week</th>
                <th>Cargo</th>
                <th>Route</th>
                <th>Company</th>
                <th>Outcome</th>
                <th class="num">Paid</th>
              </tr>
            </thead>
            <tbody>
              {past.map((c) => (
                <tr
                  key={c.id}
                  class={c.status === 'stolen' ? 'hot' : ''}
                  data-testid="ledger-contract-row"
                  data-contract-id={c.id}
                >
                  <td>{c.week}</td>
                  <td>
                    {c.qty} CU {c.cargo}
                  </td>
                  <td>
                    {c.fromName} → {c.toName}
                  </td>
                  <td>{c.company}</td>
                  <td>
                    <span class={`contract-outcome ${c.status}`}>
                      {CONTRACT_OUTCOME_WORD[c.status as keyof typeof CONTRACT_OUTCOME_WORD] ??
                        c.status}
                    </span>
                  </td>
                  <td class="num hud-num">{c.payCents > 0 ? formatCents(c.payCents) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function ByGood({ ledger }: { ledger: LedgerSnapshot }) {
  const [good, setGood] = useState<string | undefined>(undefined);
  const chosen = ledger.goods.find((g) => g.id === good) ?? ledger.goods[0];
  if (!chosen) return <Empty text="No prices written down yet. Visit a market." />;
  const rows = ledger.ports
    .map((p) => ({ port: p, price: ledger.prices[p.id]?.[chosen.id] }))
    .filter((r) => r.price);
  return (
    <div>
      <label class="menu-row">
        <span>Good</span>
        <select
          data-testid="ledger-good"
          value={chosen.id}
          onChange={(e) => setGood((e.currentTarget as HTMLSelectElement).value)}
        >
          {ledger.goods.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <table class="ledger-table">
        <thead>
          <tr>
            <th>Port</th>
            <th class="num">They ask</th>
            <th class="num">They pay</th>
            <th>Seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ port, price }) =>
            price ? (
              <tr key={port.id} class={price.stale ? 'stale' : ''}>
                <td>{port.name}</td>
                <td class="num">{formatCents(price.buyCents)}</td>
                <td class="num">{formatCents(price.sellCents)}</td>
                <td>
                  {price.age}
                  <Heard p={price} />
                </td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Ledger({ ledger, here }: { ledger: LedgerSnapshot; here?: string | undefined }) {
  // At sea the hold is what you came to look at; in port it's already beside the market.
  const [tab, setTab] = useState<LedgerTab>(here ? 'byPort' : 'hold');
  return (
    <div class="ledger" data-testid="ledger">
      <nav class="ledger-tabs">
        {TABS.map(([id, label]) => (
          <button
            type="button"
            key={id}
            class={`ledger-tab${tab === id ? ' active' : ''}`}
            data-testid={`ledger-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'hold' && <Hold ledger={ledger} />}
      {tab === 'byPort' && <ByPort ledger={ledger} here={here} />}
      {tab === 'byGood' && <ByGood ledger={ledger} />}
      {tab === 'contracts' && <Contracts ledger={ledger} />}
      {tab === 'rumors' &&
        (ledger.rumors.length ? (
          <ul class="ledger-list rumors" data-testid="ledger-rumors">
            {ledger.rumors.map((r) => (
              <RumorItem key={r.id} r={r} showWhere />
            ))}
          </ul>
        ) : (
          <Empty text="No rumors heard yet." />
        ))}
      {tab === 'standing' && <Standing ledger={ledger} />}
    </div>
  );
}

/**
 * The journal at the helm (J): the ledger on its own page, over the paused game, under
 * the First Week checklist while the run has one (piece C).
 */
export function Journal({
  ledger,
  close,
  extra,
  sailingOn,
  toggleSailOn,
}: {
  ledger: LedgerSnapshot;
  close(): void;
  extra?: ComponentChildren;
  /** True while the ship sails on behind the journal; undefined where it's always held. */
  sailingOn?: boolean | undefined;
  toggleSailOn?: (() => void) | undefined;
}) {
  return (
    <div
      class={`menu-backdrop${sailingOn ? ' under-way' : ''}`}
      data-testid="journal"
      data-sailing={sailingOn === undefined ? 'held' : sailingOn ? 'on' : 'held'}
    >
      <div class="menu port" role="dialog" aria-modal="true" aria-label="Journal">
        <header class="menu-header">
          <h2>Ledger</h2>
          <span class="menu-paused">{ledger.dateText}</span>
        </header>
        {extra}
        <Ledger ledger={ledger} />
        <footer class="menu-footer">
          {sailingOn !== undefined && toggleSailOn && (
            <span class="journal-sail-on">
              <span class={sailingOn ? 'sail-on-live' : 'port-dim'}>
                {sailingOn ? 'Sailing on' : 'Ship held'}
              </span>
              <button
                type="button"
                class="menu-button"
                data-testid="journal-sail-on"
                aria-pressed={sailingOn}
                onClick={toggleSailOn}
              >
                {sailingOn ? 'Hold the ship (P)' : 'Sail on (P)'}
              </button>
            </span>
          )}
          <button
            type="button"
            class="menu-button primary"
            data-testid="journal-close"
            onClick={close}
          >
            Close (J or Esc)
          </button>
        </footer>
      </div>
    </div>
  );
}
