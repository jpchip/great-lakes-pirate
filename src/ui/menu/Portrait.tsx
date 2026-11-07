import type { PortraitDef } from '../../../data/schemas/backgrounds';
import { portraitImageUrl } from './portrait-assets';

/**
 * A captain's portrait preset (plan 12 §2.1 step 2, Phase 4 piece C): a painted bust in
 * the brass oval from `art/portraits/`, standing in for the 3D preview until Phase 7
 * gives the captain a body.
 */

export function Portrait({ portrait: p, size = 96 }: { portrait: PortraitDef; size?: number }) {
  const src = portraitImageUrl(p.id);
  const height = Math.round((size * 120) / 100);
  return (
    <span
      class="portrait"
      style={{ width: `${size}px`, height: `${height}px` }}
      role="img"
      aria-label={p.name}
    >
      {src ? (
        <img class="portrait-bust" src={src} alt="" decoding="async" draggable={false} />
      ) : (
        <span class="portrait-bust portrait-bust--empty" aria-hidden />
      )}
      <svg class="portrait-frame" viewBox="0 0 100 120" aria-hidden>
        <ellipse cx="50" cy="60" rx="46" ry="56" fill="none" stroke="#b8892e" stroke-width="2" />
      </svg>
    </span>
  );
}
