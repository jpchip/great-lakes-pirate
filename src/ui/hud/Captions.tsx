import type { ReadonlySignal } from '@preact/signals';
import type { CaptionView } from '../../audio/captions';

/**
 * Captions for directional sounds (plan 13 §9, plan 15 §5): a line per fog signal or
 * whistle heard, with an arrow toward it from where the camera looks, low in the middle
 * of the screen above the wind ring's row. Shown at every HUD density, since they stand
 * in for a sound; Settings → Sound turns them off.
 */
export function Captions({ captions }: { captions: ReadonlySignal<readonly CaptionView[]> }) {
  const list = captions.value;
  if (list.length === 0) return null;
  return (
    <div class="hud-captions" data-testid="captions" role="status" aria-live="polite">
      {list.map((c) => (
        <div class="hud-caption" key={c.key} data-testid="caption">
          <span class="hud-caption-arrow" aria-label={arrowLabel(c.bearingDeg)}>
            {c.arrow}
          </span>
          <span>
            {c.text}
            {c.distance && <span class="hud-dim">, {c.distance}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** "ahead", "on the starboard bow", ... for screen readers. */
export function arrowLabel(bearingDeg: number): string {
  const a = Math.abs(bearingDeg);
  const side = bearingDeg >= 0 ? 'right' : 'left';
  if (a < 22.5) return 'ahead';
  if (a > 157.5) return 'behind';
  if (a < 67.5) return `ahead to the ${side}`;
  if (a < 112.5) return `to the ${side}`;
  return `behind to the ${side}`;
}
