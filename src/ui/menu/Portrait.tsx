import type { PortraitDef } from '../../../data/schemas/backgrounds';

/**
 * A captain's portrait preset (plan 12 §2.1 step 2, Phase 4 piece C), drawn as a period
 * bust in an oval: coat, face, hair, beard and hat from a handful of parts. It stands in
 * for the 3D preview until Phase 7 gives the captain a body.
 */

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number): number => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function Hat({ p }: { p: PortraitDef }) {
  const dark = '#2b2118';
  switch (p.hat) {
    case 'cap':
      return (
        <g>
          <path d="M33 36 Q50 22 67 36 L67 40 L33 40 Z" fill={dark} />
          <path d="M30 40 L70 40 Q66 45 50 44 Q36 44 30 40 Z" fill="#1a140e" />
          <rect x="45" y="31" width="10" height="4" rx="1" fill="#b8892e" />
        </g>
      );
    case "sou'wester":
      return (
        <g>
          <path d="M34 38 Q50 20 66 38 Z" fill="#c9a43a" />
          <path d="M24 42 Q50 30 76 42 Q72 48 50 45 Q28 48 24 42 Z" fill="#b8932f" />
        </g>
      );
    case 'bowler':
      return (
        <g>
          <path d="M35 38 Q35 22 50 22 Q65 22 65 38 Z" fill={dark} />
          <ellipse cx="50" cy="39" rx="20" ry="3.5" fill="#1a140e" />
        </g>
      );
    case 'wool':
      return (
        <g>
          <path d="M33 40 Q33 22 50 22 Q67 22 67 40 Z" fill="#8a2f28" />
          <rect x="32" y="36" width="36" height="6" rx="2" fill="#6e241f" />
        </g>
      );
    case 'bonnet':
      return (
        <g>
          <path d="M30 50 Q28 22 50 21 Q72 22 70 50 Q66 34 50 33 Q34 34 30 50 Z" fill="#4a3550" />
          <path d="M44 62 L40 74 M56 62 L60 74" stroke="#4a3550" stroke-width="2" />
        </g>
      );
    default:
      return null;
  }
}

function Beard({ p }: { p: PortraitDef }) {
  if (p.beard === 'mustache') {
    return <path d="M42 58 Q50 54 58 58 Q54 61 50 59 Q46 61 42 58 Z" fill={p.hair} />;
  }
  if (p.beard === 'full') {
    return (
      <path
        d="M36 50 Q36 70 50 74 Q64 70 64 50 Q62 60 56 60 Q50 57 44 60 Q38 60 36 50 Z"
        fill={p.hair}
      />
    );
  }
  return null;
}

export function Portrait({ portrait: p, size = 96 }: { portrait: PortraitDef; size?: number }) {
  const long = p.beard === 'none' && (p.hat === 'none' || p.hat === 'bonnet');
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
        {/* Coat and collar */}
        <path d="M12 120 Q14 88 50 84 Q86 88 88 120 Z" fill={p.coat} />
        <path d="M40 84 L50 100 L60 84 Z" fill="#efe6d0" />
        <path d="M40 84 L50 100 L44 104 L34 88 Z" fill={shade(p.coat, 0.75)} />
        <path d="M60 84 L50 100 L56 104 L66 88 Z" fill={shade(p.coat, 0.75)} />
        {/* Neck and head */}
        <rect x="44" y="66" width="12" height="20" fill={shade(p.skin, 0.85)} />
        {long && <path d="M33 46 Q30 80 40 86 L60 86 Q70 80 67 46 Z" fill={p.hair} />}
        <ellipse cx="50" cy="50" rx="15" ry="19" fill={p.skin} />
        <ellipse cx="35" cy="52" rx="2.5" ry="4" fill={shade(p.skin, 0.9)} />
        <ellipse cx="65" cy="52" rx="2.5" ry="4" fill={shade(p.skin, 0.9)} />
        {/* Hair under any hat */}
        <path d="M35 46 Q36 30 50 30 Q64 30 65 46 Q60 38 50 38 Q40 38 35 46 Z" fill={p.hair} />
        {/* Eyes, brows, nose */}
        <circle cx="44" cy="49" r="1.4" fill="#2b2118" />
        <circle cx="56" cy="49" r="1.4" fill="#2b2118" />
        <path d="M41 45 L47 45 M53 45 L59 45" stroke={shade(p.hair, 0.8)} stroke-width="1.4" />
        <path d="M50 50 L48 56 L51 56" stroke={shade(p.skin, 0.7)} fill="none" stroke-width="1" />
        <path d="M46 61 Q50 62 54 61" stroke={shade(p.skin, 0.6)} fill="none" stroke-width="1" />
        <Beard p={p} />
        <Hat p={p} />
      </g>
      <ellipse cx="50" cy="60" rx="46" ry="56" fill="none" stroke="#b8892e" stroke-width="2" />
    </svg>
  );
}
