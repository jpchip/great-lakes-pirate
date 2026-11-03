import type { PortraitDef } from '../../../data/schemas/backgrounds';
import { portraitImageUrl } from './portrait-assets';

/**
 * A captain's portrait preset (plan 12 §2.1 step 2, Phase 4 piece C): a painted bust in
 * the brass oval from `art/portraits/`, standing in for the 3D preview until Phase 7
 * gives the captain a body.
 */

export function Portrait({ portrait: p, size = 96 }: { portrait: PortraitDef; size?: number }) {
  const src = portraitImageUrl(p.id);
  const height = (size * 120) / 100;
  return (
    <svg
      class="portrait"
      viewBox="0 0 100 120"
      width={size}
      height={height}
      role="img"
      aria-label={p.name}
    >
      <defs>
        <clipPath id={`oval-${p.id}`}>
          <ellipse cx="50" cy="60" rx="46" ry="56" />
        </clipPath>
      </defs>
      <ellipse cx="50" cy="60" rx="46" ry="56" fill="#d9c393" />
      {src ? (
        <image
          href={src}
          x="0"
          y="0"
          width="100"
          height="120"
          preserveAspectRatio="xMidYMid slice"
          clip-path={`url(#oval-${p.id})`}
        />
      ) : null}
      <ellipse cx="50" cy="60" rx="46" ry="56" fill="none" stroke="#b8892e" stroke-width="2" />
    </svg>
  );
}
