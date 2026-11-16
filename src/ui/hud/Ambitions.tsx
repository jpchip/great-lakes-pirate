import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { AmbitionMark, AmbitionRow, AmbitionsSnapshot } from '../../gameplay/ambitions';

/**
 * Ambitions (plan 12 §4.1, plan 13 §4.1 and §5; Phase 8 piece H): the pinned goals on the
 * HUD, collapsible, under the First Week's tracker; and the journal's Ambitions page, where
 * goals are pinned (up to three) and the finished ones sit as themed marks in the ledger,
 * each clearable. The deed stays in the logbook.
 */

export interface AmbitionActions {
  pin(id: string): void;
  unpin(id: string): void;
  clearMark(id: string): void;
  setFolded(folded: boolean): void;
}

/** The snapshot and its buttons, for the ledger's Ambitions tab wherever the ledger is. */
export const AmbitionsContext = createContext<
  { ambitions: AmbitionsSnapshot; actions: AmbitionActions } | undefined
>(undefined);

export function useAmbitions():
  { ambitions: AmbitionsSnapshot; actions: AmbitionActions } | undefined {
  return useContext(AmbitionsContext);
}

function Meter({ fraction, label }: { fraction: number; label: string }) {
  const pct = Math.round(fraction * 100);
  return (
    <span
      class="ambition-meter"
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span class="ambition-meter-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function AmbitionsTracker({
  ambitions,
  setFolded,
}: {
  ambitions: AmbitionsSnapshot;
  setFolded(folded: boolean): void;
}) {
  const { pinned, folded, justDone } = ambitions;
  if (!pinned.length && !justDone) return null;
  return (
    <aside class="ambitions-tracker" data-testid="ambitions-tracker">
      <div class="first-week-head">
        <span class="hud-label first-week-kicker">Ambitions</span>
        <span class="hud-num">
          {pinned.length}/{ambitions.maxPinned}
        </span>
        <button
          type="button"
          class="first-week-close"
          title={folded ? 'Show the pinned ambitions' : 'Fold the pinned ambitions'}
          aria-expanded={!folded}
          data-testid="ambitions-fold"
          onClick={() => setFolded(!folded)}
        >
          {folded ? '▸' : '▾'}
        </button>
      </div>
      {justDone && (
        <div class="ambition-just-done" data-testid="ambition-just-done">
          ✓ {justDone.name}
          {justDone.reward && <span class="hud-dim"> · {justDone.reward}</span>}
        </div>
      )}
      {!folded && (
        <ul class="ambitions-hud-list">
          {pinned.map((a) => (
            <li key={a.id} data-testid="ambition-pinned" data-ambition-id={a.id}>
              <div class="ambition-hud-name">{a.name}</div>
              <Meter fraction={a.fraction} label={`${a.name}, ${a.progress}`} />
              <div class="hud-dim">{a.progress}</div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/** A themed mark: the stamp of its category, the deed, when, and what it paid. */
function Mark({ mark, clear }: { mark: AmbitionMark; clear(): void }) {
  return (
    <li
      class={`ambition-mark mark-${mark.category}`}
      data-testid="ambition-mark"
      data-ambition-id={mark.id}
    >
      <span class="ambition-stamp" title={mark.markName} aria-hidden="true">
        {mark.legend}
      </span>
      <span class="ambition-mark-text">
        <strong>{mark.name}</strong>
        <small class="port-dim">
          {mark.markName} · {mark.dateText}
          {mark.reward ? ` · ${mark.reward}` : ''}
        </small>
      </span>
      <button
        type="button"
        class="menu-button ambition-clear"
        data-testid="ambition-clear"
        title="Clear the mark from the ledger (the logbook keeps the deed)"
        onClick={clear}
      >
        Clear
      </button>
    </li>
  );
}

function Goal({ a, full, actions }: { a: AmbitionRow; full: boolean; actions: AmbitionActions }) {
  return (
    <li
      class={`ambition-row${a.pinned ? ' pinned' : ''}`}
      data-testid="ambition-row"
      data-ambition-id={a.id}
    >
      <span class="ambition-row-main">
        <strong>{a.name}</strong> <span class="port-dim">{a.text}</span>
        <span class="ambition-row-progress">
          <Meter fraction={a.fraction} label={`${a.name}, ${a.progress}`} />
          <small class="port-dim">
            {a.progress}
            {a.reward ? ` · pays ${a.reward}` : ''}
          </small>
        </span>
      </span>
      <button
        type="button"
        class={`menu-button ambition-pin${a.pinned ? ' primary' : ''}`}
        data-testid="ambition-pin"
        aria-pressed={a.pinned}
        disabled={!a.pinned && full}
        title={
          a.pinned
            ? 'Stop following it on the HUD'
            : full
              ? 'Three are pinned: unpin one first'
              : 'Follow it on the HUD'
        }
        onClick={() => (a.pinned ? actions.unpin(a.id) : actions.pin(a.id))}
      >
        {a.pinned ? 'Unpin' : 'Pin'}
      </button>
    </li>
  );
}

export function AmbitionsPage({
  ambitions,
  actions,
}: {
  ambitions: AmbitionsSnapshot;
  actions: AmbitionActions;
}) {
  const full = ambitions.pinned.length >= ambitions.maxPinned;
  const categories = [...new Set(ambitions.open.map((a) => a.category))];
  return (
    <div class="ambitions-page" data-testid="ledger-ambitions">
      <p class="port-dim">
        Pin up to {ambitions.maxPinned} to follow on the HUD. {ambitions.doneCount} of{' '}
        {ambitions.total} done.
      </p>
      {ambitions.refusal && <p class="ambition-warn">{ambitions.refusal}</p>}
      {ambitions.marks.length > 0 && (
        <section class="ledger-section">
          <h4>Marks</h4>
          <ul class="ambition-marks" data-testid="ambition-marks">
            {ambitions.marks.map((m) => (
              <Mark key={m.id} mark={m} clear={() => actions.clearMark(m.id)} />
            ))}
          </ul>
        </section>
      )}
      {categories.map((c) => {
        const rows = ambitions.open.filter((a) => a.category === c);
        return (
          <section key={c} class="ledger-section">
            <h4>{rows[0]?.categoryName}</h4>
            <ul class="ambition-list">
              {rows.map((a) => (
                <Goal key={a.id} a={a} full={full} actions={actions} />
              ))}
            </ul>
          </section>
        );
      })}
      {ambitions.open.length === 0 && (
        <p class="ledger-empty">Every ambition done. The lake has nothing left to prove.</p>
      )}
    </div>
  );
}
