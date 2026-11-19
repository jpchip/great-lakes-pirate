import { SLEEP_CHOICES } from '../../sim/hideouts/life';
import type { SleepActions, SleepView } from '../../gameplay/hideout-life';

/**
 * The bunk's choice (plan 09 §3, plan 13 §12; Phase 8 piece F): sleep until dawn, noon,
 * dusk or for eight hours. Asleep at a hideout you lay low: the law in its region cools
 * faster than with you away. The game saves when you wake.
 */
export function SleepDialog({ view, actions }: { view: SleepView; actions: SleepActions }) {
  const cooling = view.heat > 0;
  return (
    <div class="menu-backdrop" data-testid="sleep-dialog">
      <div class="menu lie" role="dialog" aria-modal="true" aria-label="Sleep">
        <header class="menu-header">
          <h2>Sleep in the bunk</h2>
          <p class="port-dim">
            Lie up at {view.place} and let the world go on without you.{' '}
            {cooling
              ? `The law in ${view.regionName} (${view.tierName}) cools ${view.factor} times as fast while you lie low here.`
              : `Nobody in ${view.regionName} is looking for you.`}
          </p>
        </header>
        {view.message && (
          <p class="port-message" role="status">
            {view.message}
          </p>
        )}
        <footer class="menu-footer port-footer">
          <span class="stash-lie">
            {SLEEP_CHOICES.map(([id, label]) => (
              <button
                type="button"
                key={id}
                class="menu-button"
                data-testid={`sleep-${id}`}
                onClick={() => actions.sleep(id)}
              >
                {label}
              </button>
            ))}
            {view.iceOut && (
              <button
                type="button"
                class="menu-button"
                data-testid="sleep-iceOut"
                onClick={() => actions.sleep('iceOut')}
              >
                {view.iceOut}
              </button>
            )}
          </span>
          <button
            type="button"
            class="menu-button primary"
            data-testid="sleep-close"
            onClick={actions.close}
          >
            Stay up (Esc)
          </button>
        </footer>
      </div>
    </div>
  );
}
