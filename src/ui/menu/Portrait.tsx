import type { PortraitDef } from '../../../data/schemas/backgrounds';

/**
 * A captain's portrait preset (plan 12 §2.1 step 2, Phase 4 piece C), drawn as a period
 * bust in an oval: coat, face, hair, beard and hat from a handful of parts. It stands in
 * for the 3D preview until Phase 7 gives the captain a body.
 *
 * The face sits in a 100 × 120 box: head centered at x 50, from the crown at y 28 to the
 * chin at y 70. Nothing but the beard and the features is drawn over the face, so hair
 * and hat ties stay outside it whatever the skin and hair colors.
 */

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number): number => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** The head's outline: a rounded crown and a tapering jaw. */
const HEAD =
  'M35 47 Q35 28 50 28 Q65 28 65 47 Q65 62 58 67 Q54 70 50 70 Q46 70 42 67 Q35 62 35 47 Z';

/** Hair that falls behind the head, outside the face. */
function BackHair({ p }: { p: PortraitDef }) {
  if (p.hairStyle === 'long') {
    return (
      <path
        d="M34 44 Q30 64 32 86 L40 86 Q37 70 37 56 Z M66 44 Q70 64 68 86 L60 86 Q63 70 63 56 Z"
        fill={p.hair}
      />
    );
  }
  if (p.hairStyle === 'braid') {
    // Pinned at the back, one braid forward over the right shoulder.
    return (
      <g fill={p.hair}>
        <path d="M63 50 Q68 58 66 66 L62 64 Q63 57 61 52 Z" />
        {[68, 74, 80, 86].map((y) => (
          <ellipse key={y} cx={65 - (y - 68) * 0.15} cy={y} rx="3.4" ry="3.6" />
        ))}
        <path d="M62 90 L64 96 L67 90 Z" />
      </g>
    );
  }
  return null;
}

/** Hair on top of the head, under any hat. */
function TopHair({ p }: { p: PortraitDef }) {
  if (p.hairStyle === 'short') {
    return <path d="M35 46 Q34 28 50 27 Q66 28 65 46 Q62 37 50 36 Q38 37 35 46 Z" fill={p.hair} />;
  }
  // Parted in the middle and drawn back over the ears.
  return (
    <path
      d="M34 50 Q32 27 50 26 Q68 27 66 50 Q64 40 58 36 Q54 34 50 37 Q46 34 42 36 Q36 40 34 50 Z"
      fill={p.hair}
    />
  );
}

function Beard({ p }: { p: PortraitDef }) {
  if (p.beard === 'mustache') {
    return <path d="M43 59 Q50 55 57 59 Q54 61.5 50 60 Q46 61.5 43 59 Z" fill={p.hair} />;
  }
  if (p.beard === 'full') {
    return (
      <path
        d="M35.5 50 Q36 66 43 71 Q50 76 57 71 Q64 66 64.5 50 Q62 58 57 60 Q50 57 43 60 Q38 58 35.5 50 Z"
        fill={p.hair}
      />
    );
  }
  return null;
}

function Hat({ p }: { p: PortraitDef }) {
  const dark = '#2b2118';
  switch (p.hat) {
    case 'cap':
      return (
        <g>
          <path d="M33 37 Q50 22 67 37 L67 41 L33 41 Z" fill={dark} />
          <path d="M31 41 L69 41 Q65 46 50 45 Q35 46 31 41 Z" fill="#1a140e" />
          <rect x="45" y="32" width="10" height="4" rx="1" fill="#b8892e" />
        </g>
      );
    case "sou'wester":
      return (
        <g>
          <path d="M34 39 Q50 20 66 39 Z" fill="#c9a43a" />
          <path d="M24 43 Q50 31 76 43 Q72 49 50 46 Q28 49 24 43 Z" fill="#b8932f" />
        </g>
      );
    case 'bowler':
      return (
        <g>
          <path d="M35 39 Q35 22 50 22 Q65 22 65 39 Z" fill={dark} />
          <ellipse cx="50" cy="40" rx="20" ry="3.5" fill="#1a140e" />
        </g>
      );
    case 'wool':
      return (
        <g>
          <path d="M33 41 Q33 22 50 22 Q67 22 67 41 Z" fill="#8a2f28" />
          <rect x="32" y="37" width="36" height="6" rx="2" fill="#6e241f" />
        </g>
      );
    case 'bonnet': {
      // A brimmed bonnet framing the face, its ribbons down the cheeks' outside to a bow
      // under the chin.
      const ribbon = shade(p.coat, 1.25);
      return (
        <g>
          <path
            d="M29 56 Q26 24 50 21 Q74 24 71 56 Q70 42 64 35 Q57 30 50 30 Q43 30 36 35 Q30 42 29 56 Z"
            fill={p.coat}
          />
          <path
            d="M29 56 Q30 40 36 35 Q43 30 50 30 Q57 30 64 35 Q70 40 71 56"
            fill="none"
            stroke={shade(p.coat, 0.7)}
            stroke-width="1.5"
          />
          <path
            d="M31 55 Q32 68 46 73 M69 55 Q68 68 54 73"
            fill="none"
            stroke={ribbon}
            stroke-width="2"
          />
          <path d="M50 73 L43 69 L43 77 Z M50 73 L57 69 L57 77 Z" fill={ribbon} />
          <circle cx="50" cy="73" r="1.8" fill={shade(p.coat, 0.8)} />
        </g>
      );
    }
    default:
      return null;
  }
}

export function Portrait({ portrait: p, size = 96 }: { portrait: PortraitDef; size?: number }) {
  const brow = shade(p.hair, 0.8);
  const line = shade(p.skin, 0.62);
  return (
    <svg
      class="portrait"
      viewBox="0 0 100 120"
      width={size}
      height={(size * 120) / 100}
      role="img"
      aria-label={p.name}
    >
      <defs>
        <clipPath id={`oval-${p.id}`}>
          <ellipse cx="50" cy="60" rx="46" ry="56" />
        </clipPath>
      </defs>
      <ellipse cx="50" cy="60" rx="46" ry="56" fill="#d9c393" />
      <g clip-path={`url(#oval-${p.id})`}>
        <BackHair p={p} />
        {/* Coat and collar */}
        <path d="M12 120 Q14 88 50 84 Q86 88 88 120 Z" fill={p.coat} />
        <path d="M40 84 L50 100 L60 84 Z" fill="#efe6d0" />
        <path d="M40 84 L50 100 L44 104 L34 88 Z" fill={shade(p.coat, 0.75)} />
        <path d="M60 84 L50 100 L56 104 L66 88 Z" fill={shade(p.coat, 0.75)} />
        {p.hairStyle === 'braid' &&
          [88, 94].map((y) => (
            <ellipse key={y} cx={65 - (y - 68) * 0.15} cy={y} rx="3.2" ry="3.4" fill={p.hair} />
          ))}
        {/* Neck, ears and head */}
        <path d="M44 64 L44 86 L56 86 L56 64 Z" fill={shade(p.skin, 0.85)} />
        <ellipse cx="35" cy="51" rx="2.6" ry="4.2" fill={shade(p.skin, 0.9)} />
        <ellipse cx="65" cy="51" rx="2.6" ry="4.2" fill={shade(p.skin, 0.9)} />
        <path d={HEAD} fill={p.skin} />
        <TopHair p={p} />
        {/* Eyes, brows, nose, mouth */}
        <ellipse cx="44" cy="49.5" rx="2.6" ry="1.5" fill="#f3ecdc" />
        <ellipse cx="56" cy="49.5" rx="2.6" ry="1.5" fill="#f3ecdc" />
        <circle cx="44.3" cy="49.5" r="1.2" fill="#2b2118" />
        <circle cx="56.3" cy="49.5" r="1.2" fill="#2b2118" />
        <path
          d="M40.5 46 Q44 44.3 47.5 45.6 M52.5 45.6 Q56 44.3 59.5 46"
          stroke={brow}
          fill="none"
          stroke-width="1.3"
          stroke-linecap="round"
        />
        <path
          d="M50 50 Q49 54 47.8 56 Q50 57.2 52.2 56"
          stroke={line}
          fill="none"
          stroke-width="0.9"
          stroke-linecap="round"
        />
        <path
          d="M46.5 62 Q50 63.4 53.5 62"
          stroke={line}
          fill="none"
          stroke-width="1"
          stroke-linecap="round"
        />
        <Beard p={p} />
        <Hat p={p} />
      </g>
      <ellipse cx="50" cy="60" rx="46" ry="56" fill="none" stroke="#b8892e" stroke-width="2" />
    </svg>
  );
}
