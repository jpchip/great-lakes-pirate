import type { EventSceneView } from '../../gameplay/events';

/**
 * A sandbox event's scene on paper (plan 12 §5.1; Phase 9 piece A): met on a voyage (a
 * lifeboat adrift) or on docking (an idle crew on the pier), with its choices. The game
 * waits behind it; after a choice it says what came of it and is put away.
 */

export interface EventSceneActions {
  choose(choice: string): string | undefined;
  close(): void;
}

export function EventScene({
  scene,
  actions,
}: {
  scene: EventSceneView;
  actions: EventSceneActions;
}) {
  return (
    <div
      class="end-screen event-scene-screen"
      data-testid="event-scene"
      data-key={scene.key}
      data-kind={scene.kind}
      role="dialog"
      aria-modal="true"
      aria-label={scene.title}
    >
      <article class="event-scene">
        <div class="event-scene-place">{scene.place}</div>
        <h2 class="event-scene-title">{scene.title}</h2>
        <p class="event-scene-body">{scene.body}</p>
        {scene.result ? (
          <>
            <p class="event-scene-result" data-testid="event-scene-result">
              {scene.result}
            </p>
            <footer class="event-scene-choices">
              <button
                type="button"
                class="menu-button primary"
                data-testid="event-scene-close"
                onClick={() => actions.close()}
              >
                {scene.kind === 'chart' ? 'Back to the chart' : 'Go on'}
              </button>
            </footer>
          </>
        ) : (
          <footer class="event-scene-choices">
            {scene.choices.map((c, i) => (
              <button
                type="button"
                key={c.id}
                class={`menu-button${i === 0 ? ' primary' : ''}`}
                data-testid={`event-choice-${c.id}`}
                disabled={!c.affordable}
                title={c.affordable ? undefined : "You haven't the money"}
                onClick={() => actions.choose(c.id)}
              >
                {c.label}
                {c.costText && <span class="choice-cost"> ({c.costText})</span>}
              </button>
            ))}
          </footer>
        )}
      </article>
    </div>
  );
}
