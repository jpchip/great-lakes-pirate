import { FootTools } from './FootTools';
import type { EyeView, GemView, NoiseView, StealthHudSnapshot } from './stealth-model';
import './stealth.css';

/**
 * The on-foot stealth HUD (plan 13 §4.2, plan 08 §12; Phase 7 piece D): the light gem and
 * the noise ring at the bottom centre, an eye over each guard who's noticed something
 * (an arrow at the edge when they're off screen), and the dawn countdown. Every state has
 * its own shape and word, never colour alone.
 */

/** The light gem: a cut stone that fills and gains rays as you're lit. */
export function LightGem({ gem }: { gem: GemView }) {
  const fill =
    gem.level === 'hidden' ? 0 : gem.level === 'dim' ? 0.34 : gem.level === 'lit' ? 0.67 : 1;
  const y = 30 - 26 * fill;
  return (
    <div
      class={`stealth-gem gem-${gem.level}`}
      data-testid="stealth-gem"
      data-level={gem.level}
      role="status"
      aria-label={`Light: ${gem.words}`}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <defs>
          <clipPath id="gem-cut">
            <path d="M20 4L34 20L20 36L6 20Z" />
          </clipPath>
        </defs>
        {gem.level === 'exposed' && (
          <g class="gem-rays">
            <path d="M20 0V3M20 37V40M0 20H3M37 20H40M6 6L8.5 8.5M34 6L31.5 8.5M6 34L8.5 31.5M34 34L31.5 31.5" />
          </g>
        )}
        <rect
          x="0"
          y={y + 4}
          width="40"
          height="40"
          class="gem-fill"
          clip-path="url(#gem-cut)"
          style={{ opacity: 0.35 + 0.65 * Math.min(1, gem.exposure01 / 0.6) }}
        />
        <path d="M20 4L34 20L20 36L6 20Z" class="gem-edge" />
        <path d="M6 20H34M20 4L14 20L20 36M20 4L26 20L20 36" class="gem-facets" />
      </svg>
      <span class="stealth-word">{gem.words}</span>
    </div>
  );
}

/** The noise ring: as wide as you're loud; dashed while quiet. */
export function NoiseRing({ noise }: { noise: NoiseView }) {
  const r = 4 + 16 * noise.ring01;
  return (
    <div
      class={`stealth-noise noise-${noise.level}`}
      data-testid="stealth-noise"
      data-level={noise.level}
      data-radius={noise.radiusM.toFixed(1)}
      role="status"
      aria-label={`Noise: ${noise.words}`}
    >
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="2.5" class="noise-you" />
        {noise.level !== 'silent' && <circle cx="22" cy="22" r={r} class="noise-ring" />}
      </svg>
      <span class="stealth-word">{noise.words}</span>
    </div>
  );
}

const EYE_MARK: Record<EyeView['state'], string> = {
  noticed: '',
  suspicious: '?',
  alerted: '!',
  searching: '…',
};

/** One guard's eye: it fills with their suspicion; a mark says what they're doing. */
export function GuardEye({ eye }: { eye: EyeView }) {
  const w = 22 * eye.fill01;
  return (
    <div
      class={`stealth-eye eye-${eye.state}${eye.onScreen ? '' : ' offscreen'}${eye.identified ? ' known' : ''}`}
      style={{ left: `${eye.x}px`, top: `${eye.y}px` }}
      data-testid="stealth-eye"
      data-guard={eye.id}
      data-state={eye.state}
      data-fill={eye.fill01.toFixed(2)}
      role={eye.state === 'alerted' ? 'alert' : 'img'}
      aria-label={eye.label}
    >
      {!eye.onScreen && (
        <svg
          class="eye-arrow"
          viewBox="0 0 12 12"
          aria-hidden="true"
          style={{ transform: `rotate(${eye.angle}rad)` }}
        >
          <path d="M6 0L11 8H1Z" />
        </svg>
      )}
      <svg class="eye-icon" viewBox="0 0 26 16" aria-hidden="true">
        <defs>
          <clipPath id={`eye-${eye.id}`}>
            <path d="M2 8C6 2 20 2 24 8C20 14 6 14 2 8Z" />
          </clipPath>
        </defs>
        <rect
          x="2"
          y="0"
          width={w}
          height="16"
          class="eye-fill"
          clip-path={`url(#eye-${eye.id})`}
        />
        <path d="M2 8C6 2 20 2 24 8C20 14 6 14 2 8Z" class="eye-lid" />
        <circle cx="13" cy="8" r="2.4" class="eye-pupil" />
      </svg>
      {EYE_MARK[eye.state] && <span class="eye-mark">{EYE_MARK[eye.state]}</span>}
    </div>
  );
}

const DANGER_WORDS: Record<StealthHudSnapshot['danger'], string> = {
  none: '',
  suspicious: 'Someone is suspicious',
  searching: 'They are searching',
  pursued: 'Pursued!',
};

export function StealthHud({ hud }: { hud: StealthHudSnapshot }) {
  return (
    <div class="stealth-hud" data-testid="stealth-hud" data-danger={hud.danger}>
      {hud.eyes.map((e) => (
        <GuardEye key={e.id} eye={e} />
      ))}
      {hud.dawn && (
        <div
          class={`hud-chip stealth-dawn${hud.dawn.urgent ? ' urgent' : ''}`}
          data-testid="stealth-dawn"
          role="timer"
        >
          <span class="hud-num">{hud.dawn.text}</span>
        </div>
      )}
      {hud.danger !== 'none' && (
        <div class={`stealth-danger danger-${hud.danger}`} role="status">
          {DANGER_WORDS[hud.danger]}
        </div>
      )}
      <div class="stealth-meters">
        <LightGem gem={hud.gem} />
        <NoiseRing noise={hud.noise} />
      </div>
      {hud.tools && <FootTools hud={hud.tools} />}
    </div>
  );
}
