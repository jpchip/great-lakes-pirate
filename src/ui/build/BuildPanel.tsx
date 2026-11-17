import { render } from 'preact';
import { signal } from '@preact/signals';
import type { BuildActions, BuildPanelSnapshot } from './model';
import './build.css';

/**
 * The build mode's panel (plan 09 §9, plan 13 §12; Phase 8 piece C): the palette down the
 * left, the ghost's verdict by the cursor, and the queue with Build along the bottom. It
 * sits over the canvas without pausing it; clicks on it never reach the grid.
 */

const KEYS: [string, string][] = [
  ['LMB', 'place · drag for lines and rectangles'],
  ['R', 'rotate (walls: face the other way)'],
  ['X', 'deconstruct'],
  ['Q', 'pick up the piece under the cursor'],
  ['Ctrl+Z / Y', 'undo / redo'],
  ['WASD', 'pan · right drag orbit · wheel zoom'],
  ['PgUp / PgDn', 'level'],
  ['Tab', 'grid'],
  ['B / Esc', 'back on foot'],
];

function Panel({ s, a }: { s: BuildPanelSnapshot; a: BuildActions }) {
  return (
    <div class="build-ui" data-testid="build-panel">
      <aside class="build-palette">
        <header>
          <h2>Build</h2>
          <small>{s.site}</small>
        </header>
        <nav class="build-cats">
          {s.categories.map((c) => (
            <button
              key={c.id}
              class={c.id === s.category ? 'on' : ''}
              onClick={() => a.category(c.id)}
              data-testid={`build-cat-${c.id}`}
            >
              {c.name}
            </button>
          ))}
        </nav>
        <ul class="build-pieces">
          {s.pieces.map((p) => (
            <li key={p.id} class={s.held?.id === p.id ? 'on' : ''}>
              <span class="build-piece-name">{p.name}</span>
              <span class="build-variants">
                {p.variants.map((v) => (
                  <button
                    key={v.index}
                    class={[
                      s.held?.id === p.id && s.held.variant === v.index ? 'on' : '',
                      v.afford > 0 ? '' : 'short',
                    ].join(' ')}
                    title={`${v.cost} · enough for ${v.afford}`}
                    onClick={() => a.piece(p.id, v.index)}
                    data-testid={`build-piece-${p.id}-${v.index}`}
                  >
                    {v.material}
                    <small>{v.cost}</small>
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <section class="build-onhand">
          <h3>On hand{s.fromHold ? ' (storage and hold)' : ' (storage)'}</h3>
          {s.onHand.length === 0 ? (
            <p class="port-dim">No materials here</p>
          ) : (
            <ul>
              {s.onHand.map((g) => (
                <li key={g.name}>
                  <span>{g.name}</span>
                  <span class="hud-num">{g.qty}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {s.concealment && (
          <section class="build-conceal" data-testid="build-concealment">
            <h3>
              Concealment <span class="hud-num">{s.concealment.value}%</span>{' '}
              <small>{s.concealment.word}</small>
            </h3>
            {s.concealment.planned && (
              <p class="port-dim">
                {s.concealment.planned.value}% ({s.concealment.planned.word}) once built
              </p>
            )}
            <ul>
              {s.concealment.parts.map((p) => (
                <li key={p.label}>
                  <span>{p.label}</span>
                  <span class={`hud-num ${p.delta < 0 ? 'short' : ''}`}>
                    {p.label === 'The site' ? `${p.delta}%` : `${p.delta > 0 ? '+' : ''}${p.delta}`}
                  </span>
                </li>
              ))}
            </ul>
            {s.concealment.spotted && (
              <p class="build-spotted" data-testid="build-spotted">
                Seen by {s.concealment.spotted}
              </p>
            )}
          </section>
        )}
      </aside>
      <div class="build-top">
        <button class={s.tool === 'place' ? 'on' : ''} onClick={() => a.tool('place')}>
          Place
        </button>
        <button
          class={s.tool === 'remove' ? 'on' : ''}
          onClick={() => a.tool('remove')}
          data-testid="build-remove"
        >
          Deconstruct
        </button>
        <span class="build-level">
          <button onClick={() => a.level(-1)} disabled={s.level <= 0}>
            ▼
          </button>
          Level {s.level + 1} of {s.levels}
          <button onClick={() => a.level(1)} disabled={s.level >= s.levels - 1}>
            ▲
          </button>
        </span>
        <button class={s.grid ? 'on' : ''} onClick={a.grid}>
          Grid
        </button>
        <button onClick={a.undo} disabled={!s.canUndo} title="Ctrl+Z">
          Undo
        </button>
        <button onClick={a.redo} disabled={!s.canRedo} title="Ctrl+Y">
          Redo
        </button>
        <button onClick={a.close} data-testid="build-close">
          Done
        </button>
      </div>
      <dl class="build-keys">
        {KEYS.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {s.cursor && (
        <div
          class={`build-cursor ${s.cursor.ok ? 'ok' : 'bad'}`}
          style={{ left: `${s.cursor.x + 18}px`, top: `${s.cursor.y + 14}px` }}
          data-testid="build-cursor"
        >
          {s.cursor.text}
        </div>
      )}
      <footer class="build-queue" data-testid="build-queue">
        {s.queue.pieces === 0 ? (
          <span class="port-dim">
            {s.message ?? 'Nothing planned. Place pieces, then Build to put them up.'}
          </span>
        ) : (
          <>
            <span>
              <strong>{s.queue.pieces}</strong> planned · {s.queue.time}
            </span>
            <span class="build-needs">
              {s.queue.needs.map((n) => (
                <span key={n.good} class={n.have >= n.need ? '' : 'short'}>
                  {n.name}{' '}
                  <span class="hud-num">
                    {n.have}/{n.need}
                  </span>
                </span>
              ))}
            </span>
            {s.message && <span class="port-dim">{s.message}</span>}
          </>
        )}
        <button
          class="build-go"
          disabled={s.queue.buildable === 0}
          onClick={a.build}
          data-testid="build-go"
        >
          Build
          {s.queue.pieces > 0 && s.queue.buildable < s.queue.pieces
            ? ` ${s.queue.buildable} of ${s.queue.pieces}`
            : ''}
        </button>
      </footer>
    </div>
  );
}

export interface BuildPanelUi {
  set(snapshot: BuildPanelSnapshot | undefined): void;
}

/** Mounts the panel in its own root over the canvas. */
export function mountBuildPanel(root: HTMLElement, actions: BuildActions): BuildPanelUi {
  const snap = signal<BuildPanelSnapshot | undefined>(undefined);
  function App() {
    return snap.value ? <Panel s={snap.value} a={actions} /> : null;
  }
  render(<App />, root);
  return {
    set(snapshot) {
      snap.value = snapshot;
    },
  };
}
