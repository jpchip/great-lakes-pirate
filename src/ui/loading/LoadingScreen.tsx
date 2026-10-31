import type { Signal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import type { LoadingScreen as Model } from './model';

/**
 * The fade to fog behind a zone load (plan 03 §7): the place's name in the logbook hand
 * and a line under it. The card keeps its last words while the fog lifts, so the fade
 * runs both ways without the card blinking out first.
 */
export function LoadingScreen({ screen }: { screen: Signal<Model | undefined> }) {
  const shown = screen.value;
  const last = useRef<Model | undefined>(undefined);
  if (shown) last.current = shown;
  const card = shown ?? last.current;
  return (
    <div
      class={`loading ${shown ? 'loading-on' : ''}`}
      data-testid="loading-screen"
      aria-hidden={!shown}
      role="status"
    >
      {card && (
        <div class="loading-card">
          <div class="loading-kicker">Making for</div>
          <div class="loading-title">{card.title}</div>
          <div class="loading-rule" />
          <div class="loading-line">{card.line}</div>
        </div>
      )}
    </div>
  );
}
