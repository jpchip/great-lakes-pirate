import type { ReadonlySignal } from '@preact/signals';
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
  notice: string | undefined;
  inBoat: boolean;
  /** Clicks lock the mouse for looking; until then the hint says so. */
  mouseLocked: boolean;
}

function ColdChip({ cold }: { cold: NonNullable<FootHudView['cold']> }) {
  const deadly = cold.word === 'deadly' || cold.word === 'bitter';
  const last = Math.max(0, Math.round(cold.lastS));
  return (
    <div class={`hud-chip${deadly ? ' danger' : ''}`} data-testid="foot-cold" role="alert">
      {cold.word === 'cool' ? 'Cool water' : `${cold.word[0]?.toUpperCase()}${cold.word.slice(1)} water`}{' '}
      <span class="hud-num">{Math.round(cold.waterC)} °C</span>
      {deadly && <span class="hud-dim"> · get out: about {last < 120 ? `${last} s` : `${Math.round(last / 60)} min`}</span>}
    </div>
  );
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
          {h.prompt} <span class="hud-key">F</span>
        </button>
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
            {h.cold && <ColdChip cold={h.cold} />}
            {h.notice && (
              <div class="hud-chip" data-testid="foot-notice">
                {h.notice}
              </div>
            )}
          </div>
          <div class="foot-keys hud-dim" data-testid="foot-keys">
            {h.inBoat
              ? 'W/S pull or back water · A/D turn'
              : 'WASD move · Shift run · C crouch · Space hop, vault or climb'}
            {!h.mouseLocked && ' · click to look'}
          </div>
        </>
      )}
    </div>
  );
}
