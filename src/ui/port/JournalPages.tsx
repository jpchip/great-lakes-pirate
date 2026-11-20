import type { JournalDiscovery } from '../../gameplay/discovery';

/**
 * The journal's discovery pages (plan 13 §5, plan 11 §11; Phase 9 piece O): Leads with
 * their search areas and clues, Legends with their steps, Discoveries by kind, and the
 * Curios catalog. Logbook paper, as the rest of the ledger.
 */

function Empty({ text }: { text: string }) {
  return <p class="ledger-empty">{text}</p>;
}

export function LeadsPage({ journal }: { journal: JournalDiscovery }) {
  if (!journal.leads.length) {
    return (
      <Empty text="No leads yet. Tall tales in the saloons, papers taken from a ship or an office, a keeper's log: any of them may set you looking." />
    );
  }
  return (
    <ul class="journal-entries" data-testid="journal-leads">
      {journal.leads.map((l) => (
        <li
          key={l.id}
          class={`journal-entry${l.closedText ? ' closed' : ''}`}
          data-testid="journal-lead"
          data-lead={l.id}
        >
          <div class="journal-entry-head">
            <strong>{l.title}</strong> <span class="port-dim">· {l.kindText}</span>
          </div>
          <small class="port-dim">
            {capitalize(l.where)} · {l.closedText ?? l.areaText}
          </small>
          <ol class="journal-clues">
            {l.clues.map((c, i) => (
              <li key={i}>
                “{c.text}”
                <br />
                <small class="port-dim">
                  {capitalize(c.from)}, {c.dateText}
                </small>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ul>
  );
}

export function LegendsPage({ journal }: { journal: JournalDiscovery }) {
  return (
    <ul class="journal-entries" data-testid="journal-legends">
      {journal.legends.map((l) =>
        l.status ? (
          <li key={l.id} class="journal-entry" data-testid="journal-legend" data-legend={l.id}>
            <div class="journal-entry-head">
              <strong>{l.name}</strong>{' '}
              <span class={`journal-status${l.status === 'Found' ? ' found' : ''}`}>
                {l.status}
              </span>
            </div>
            <small class="port-dim">
              {l.where} · {l.heardText}
            </small>
            {l.line && <p class="journal-quote">“{l.line}”</p>}
            <ul class="journal-steps">
              {l.steps.map((s, i) => (
                <li key={i} class={s.done ? 'done' : ''}>
                  <span aria-hidden="true">{s.done ? '✓' : '○'}</span> {s.text}
                </li>
              ))}
            </ul>
            {l.told && <p class="journal-told">{l.told}</p>}
          </li>
        ) : (
          <li key={l.id} class="journal-entry blank" data-testid="journal-legend-blank">
            <span class="port-dim">{l.name}. </span>
            <small class="port-dim">{l.heardText}</small>
          </li>
        ),
      )}
    </ul>
  );
}

export function DiscoveriesPage({ journal }: { journal: JournalDiscovery }) {
  const any = journal.discoveries.some((g) => g.rows.length > 0);
  return (
    <div data-testid="journal-discoveries">
      {!any && (
        <Empty text="Nothing charted yet. Keep a lookout along the islands: coves, caves and camps go on the chart as you find them." />
      )}
      {journal.discoveries.map((g) => (
        <section key={g.kind} class="ledger-section" data-testid={`discoveries-${g.kind}`}>
          <h4>
            {g.title} <span class="port-dim">· {g.countText}</span>
          </h4>
          {g.rows.length > 0 && (
            <ul class="journal-entries compact">
              {g.rows.map((r) => (
                <li
                  key={r.id}
                  class={`journal-entry${r.reported ? ' reported' : ''}`}
                  data-testid="discovery-row"
                  data-discovery={r.id}
                >
                  <strong>{r.name}</strong>{' '}
                  <small class="port-dim">
                    · {r.howText}, {r.dateText}
                  </small>
                  <br />
                  <small>{r.text}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function CuriosPage({ journal }: { journal: JournalDiscovery }) {
  return (
    <div data-testid="journal-curios">
      <p class="port-dim">
        {journal.curios.length} of {journal.curiosTotal} curios found. Set them out on the shelves,
        tables and sea chests of a hideout from its Curios tab.
      </p>
      {journal.curios.length === 0 ? (
        <Empty text="No curios yet: they turn up in caches, wrecks and the ends of legends." />
      ) : (
        <ul class="journal-entries">
          {journal.curios.map((c) => (
            <li key={c.id} class="journal-entry" data-testid="journal-curio" data-curio={c.id}>
              <strong>{c.name}</strong>
              <br />
              <small>{c.text}</small>
              <br />
              <small class="port-dim">
                From {c.from}, {c.dateText} · {c.whereText}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
