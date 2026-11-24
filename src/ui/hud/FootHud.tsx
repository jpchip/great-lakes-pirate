import type { ReadonlySignal } from '@preact/signals';
import { keyName, keyText } from '../keys';
import type { HudDensity } from '../../core/settings';

/**
 * The on-foot HUD for piece A (plan 13 §4.2, the part that isn't stealth): the clock top
 * left, health bottom left with the cold-water warning, the F prompt over the center, and
 * a notice. Piece D adds the light gem, noise ring and eyes; piece E the tool belt.
 */

export interface FootHudView {
  dateText: string;
  timeText: string;
  /** 0–100. */
  health: number;
  hurt: boolean;
  /** In the water: how cold, and about how many seconds you'd last at this health. */
  cold: { word: string; waterC: number; lastS: number } | undefined;
  /** What F does here, if anything. */
  prompt: string | undefined;
  /** The notices up now, oldest first (ui/hud/notices). */
  notices: readonly string[];
  inBoat: boolean;
  /** Clicks lock the mouse for looking; until then the hint says so. */
  mouseLocked: boolean;
  /** A jailbreak's standing line (piece G): what to do, and "ONE CHANCE" before the rope. */
  banner?: { text: string; oneChance: boolean } | undefined;
  /**
   * The warmth meter (Phase 9 piece M), 0–100, when the cold has a say: its stage and
   * whether you're wet through.
   */
  warmth?: { value: number; stage: string; wet: boolean } | undefined;
}

const WARMTH_WORDS: Readonly<Record<string, string>> = {
  warm: 'Warm',
  chilled: 'Chilled',
  cold: 'Cold: find a fire',
  freezing: 'Freezing: get to a fire now',
  frozen: 'Freezing to death',
};

function WarmthBar({ warmth }: { warmth: NonNullable<FootHudView['warmth']> }) {
  const v = Math.max(0, Math.min(1, warmth.value / 100));
  const danger = warmth.stage === 'freezing' || warmth.stage === 'frozen';
  return (
    <>
      <div class={`hud-bar foot-warmth${danger ? ' danger' : ''}`} data-testid="foot-warmth">
        <span class="hud-label">Warmth</span>
        <span class="hud-bar-track">
          <span class="hud-bar-fill" style={{ transform: `scaleX(${v.toFixed(3)})` }} />
        </span>
      </div>
      {(warmth.stage !== 'warm' || warmth.wet) && (
        <div
          class={`hud-chip${danger ? ' danger' : ''}`}
          data-testid="foot-warmth-word"
          role={danger ? 'alert' : 'status'}
        >
          {WARMTH_WORDS[warmth.stage] ?? warmth.stage}
          {warmth.wet && <span class="hud-dim"> · wet through</span>}
        </div>
      )}
    </>
  );
}

function ColdChip({ cold }: { cold: NonNullable<FootHudView['cold']> }) {
  const deadly = cold.word === 'deadly' || cold.word === 'bitter';
  const last = Math.max(0, Math.round(cold.lastS));
  return (
    <div class={`hud-chip${deadly ? ' danger' : ''}`} data-testid="foot-cold" role="alert">
      {cold.word === 'cool'
        ? 'Cool water'
        : `${cold.word[0]?.toUpperCase()}${cold.word.slice(1)} water`}{' '}
      <span class="hud-num">{Math.round(cold.waterC)} °C</span>
      {deadly && (
        <span class="hud-dim">
          {' '}
          · get out: about {last < 120 ? `${last} s` : `${Math.round(last / 60)} min`}
        </span>
      )}
    </div>
  );
}

const k = (action: Parameters<typeof keyName>[0]): string => keyName(action, 'onFoot');

/** The keys line at the oars, as bound now. */
function boatKeys(): string {
  return `${k('MoveForward')}/${k('MoveBack')} pull or back water · ${k('MoveLeft')}/${k('MoveRight')} turn`;
}

/** The keys line on foot, as bound now. */
function footKeys(): string {
  const move = [k('MoveForward'), k('MoveLeft'), k('MoveBack'), k('MoveRight')];
  const wasd = move.every((m) => m.length === 1) ? move.join('') : move.join('/');
  return `${wasd} move · ${k('Sprint')} run · ${k('Crouch')} crouch · ${k('LeanLeft')}/${k('LeanRight')} lean · ${k('Jump')} hop, vault or climb`;
}

export function FootHud({
  hud,
  density,
  onPrompt,
}: {
  hud: ReadonlySignal<FootHudView | undefined>;
  density: ReadonlySignal<HudDensity>;
  onPrompt?: (() => void) | undefined;
}) {
  const h = hud.value;
  if (!h) return null;
  const mode = density.value;
  const v = Math.max(0, Math.min(1, h.health / 100));
  return (
    <div class="hud foot-hud" data-testid="foot-hud" data-density={mode}>
      {h.prompt && (
        <button
          type="button"
          class="hud-take-chart foot-prompt"
          data-testid="foot-prompt"
          onClick={() => onPrompt?.()}
        >
          {keyText(h.prompt, 'onFoot')} <span class="hud-key">{keyName('Interact', 'onFoot')}</span>
        </button>
      )}
      {h.banner && (
        <div
          class={`foot-banner${h.banner.oneChance ? ' one-chance' : ''}`}
          data-testid="foot-banner"
          role="status"
        >
          {h.banner.oneChance && <strong>ONE CHANCE</strong>}
          <span>{keyText(h.banner.text, 'onFoot')}</span>
        </div>
      )}
      {mode !== 'off' && (
        <>
          <div class="hud-clock" data-testid="hud-clock">
            <span>{h.dateText}</span>
            <span class="hud-num">{h.timeText}</span>
          </div>
          <div class="hud-status">
            {(mode === 'full' || h.health < 100) && (
              <div class={`hud-bar${h.hurt ? ' danger' : ''}`} data-testid="foot-health">
                <span class="hud-label">Life</span>
                <span class="hud-bar-track">
                  <span class="hud-bar-fill" style={{ transform: `scaleX(${v.toFixed(3)})` }} />
                </span>
              </div>
            )}
            {h.warmth && <WarmthBar warmth={h.warmth} />}
            {h.cold && <ColdChip cold={h.cold} />}
            {h.notices.map((n) => (
              <div class="hud-chip" data-testid="foot-notice" key={n}>
                {keyText(n, 'onFoot')}
              </div>
            ))}
          </div>
          <div class="foot-keys hud-dim" data-testid="foot-keys">
            {h.inBoat ? boatKeys() : footKeys()}
            {!h.mouseLocked && ' · click to look'}
          </div>
        </>
      )}
    </div>
  );
}
