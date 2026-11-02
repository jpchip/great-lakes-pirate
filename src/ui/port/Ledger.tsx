import { useState } from 'preact/hooks';
import { formatCents } from '../../sim/economy/knowledge';
import type { LedgerPrice, LedgerSnapshot, RumorRow } from './model';

/**
 * The ledger (plan 05 §12; journal v1, plan 13 §5): the prices you've seen with their
 * dates, by port or by good, then contracts, rumors and Standing. It's a tab on the port
 * screen and the journal at the helm (J). Stale prices are fog gray and say how old they
 * are, so color is never the only signal (plan 13 §2.2).
 */

type LedgerTab = 'byPort' | 'byGood' | 'contracts' | 'rumors' | 'standing';

const TABS: [LedgerTab, string][] = [
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
  const [tab, setTab] = useState<LedgerTab>('byPort');
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
      {tab === 'byPort' && <ByPort ledger={ledger} here={here} />}
      {tab === 'byGood' && <ByGood ledger={ledger} />}
      {tab === 'contracts' &&
        (ledger.contracts.length ? (
          <ul class="ledger-list">
            {ledger.contracts.map((c) => (
              <li key={c.id}>{c.text}</li>
            ))}
          </ul>
        ) : (
          <Empty text="No contracts in hand." />
        ))}
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
      {tab === 'standing' &&
        (ledger.standing.length ? (
          <ul class="ledger-list">
            {ledger.standing.map((s) => (
              <li key={s.id}>
                {s.name}: {s.value}
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="No standing with any port or company yet." />
        ))}
    </div>
  );
}

/** The journal at the helm (J): the ledger on its own page, over the paused game. */
export function Journal({ ledger, close }: { ledger: LedgerSnapshot; close(): void }) {
  return (
    <div class="menu-backdrop" data-testid="journal">
      <div class="menu port" role="dialog" aria-modal="true" aria-label="Journal">
        <header class="menu-header">
          <h2>Ledger</h2>
          <span class="menu-paused">{ledger.dateText}</span>
        </header>
        <Ledger ledger={ledger} />
        <footer class="menu-footer">
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
