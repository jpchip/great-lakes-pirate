import type { SledActions, SledLotRow, SledView } from '../../gameplay/sled-picker';

/**
 * The hand sled's picker (piece M): beside the ship on the ice, her hold on the left and the
 * sled on the right. A click moves one CU, shift-click the whole lot (as far as she'll take
 * it); "Fill" loads the most valuable first. Esc or Done closes it.
 */

function Lots({
  title,
  rows,
  empty,
  arrow,
  testid,
  move,
}: {
  title: string;
  rows: SledLotRow[];
  empty: string;
  arrow: string;
  testid: string;
  move(row: SledLotRow, all: boolean): void;
}) {
  return (
    <section class="stash-column" data-testid={testid}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p class="port-dim">{empty}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={`${r.name}-${r.index}`} class={r.hot ? 'hot' : ''}>
              <span>
                {r.name}
                {r.hot && <small class="port-dim"> (hot)</small>}
                {r.contract && <small class="port-dim"> (contract)</small>}
              </span>
              <span class="hud-num">{r.qty} CU</span>
              <span class="stash-row-buttons">
                {!r.contract && (
                  <>
                    <button
                      type="button"
                      class="port-mini"
                      data-testid={`${testid}-one-${r.index}`}
                      onClick={(e) => move(r, e.shiftKey)}
                      title="One CU (shift-click: all)"
                    >
                      {arrow} 1
                    </button>
                    <button
                      type="button"
                      class="port-mini"
                      data-testid={`${testid}-all-${r.index}`}
                      onClick={() => move(r, true)}
                    >
                      {arrow} All
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SledDialog({ view, actions }: { view: SledView; actions: SledActions }) {
  const frac = view.capacity > 0 ? Math.min(1, view.used / view.capacity) : 0;
  return (
    <div class="menu-backdrop" data-testid="sled-dialog">
      <div class="menu port" role="dialog" aria-modal="true" aria-label="The hand sled">
        <header class="menu-header">
          <h2>The hand sled</h2>
          <div class="port-capacity">
            <span>
              Sled{' '}
              <span class="hud-num">
                {view.used} / {view.capacity} CU
              </span>
            </span>
            <div class="port-capacity-bar" aria-hidden="true">
              <div style={{ width: `${(frac * 100).toFixed(1)}%` }} />
            </div>
          </div>
        </header>
        {view.message && (
          <p class="port-message" role="status" data-testid="sled-message">
            {view.message}
          </p>
        )}
        <div class="port-body stash-body">
          <Lots
            title="Her hold"
            rows={view.hold}
            empty="Empty."
            arrow="→"
            testid="sled-hold"
            move={(r, all) => actions.load(r.index, all ? undefined : 1)}
          />
          <Lots
            title="On the sled"
            rows={view.sled}
            empty="Nothing on her yet."
            arrow="←"
            testid="sled-load"
            move={(r, all) => actions.unload(r.index, all ? undefined : 1)}
          />
        </div>
        <footer class="menu-footer port-footer">
          <span class="stash-lie">
            <button
              type="button"
              class="menu-button"
              data-testid="sled-fill"
              onClick={actions.fill}
            >
              Fill with the most valuable
            </button>
            <button
              type="button"
              class="menu-button"
              data-testid="sled-empty"
              onClick={actions.empty}
            >
              Unload everything
            </button>
            {view.sled.length === 0 && (
              <button
                type="button"
                class="menu-button"
                data-testid="sled-stow"
                onClick={actions.stow}
              >
                Stow the sled aboard
              </button>
            )}
          </span>
          <button
            type="button"
            class="menu-button primary"
            data-testid="sled-close"
            onClick={actions.close}
          >
            Done (Esc)
          </button>
        </footer>
      </div>
    </div>
  );
}
