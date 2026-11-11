import type { FootToolsSnapshot } from './foot-tools-model';
import './foot-tools.css';

/**
 * The tool belt (1–5), the conduct line over it and the F prompt (plan 13 §4.2, plan 08
 * §12; Phase 7 piece E). A prompt that can't be done says why, in words, and is dimmed.
 */
export function FootTools({ hud }: { hud: FootToolsSnapshot }) {
  return (
    <div class="foot-tools" data-testid="foot-tools">
      {hud.prompt && (
        <div
          class={`foot-prompt${hud.prompt.ok ? '' : ' blocked'}`}
          data-testid="foot-prompt"
          data-ok={String(hud.prompt.ok)}
          role="status"
        >
          <span class="foot-key">
            {hud.prompt.hold01 > 0 && (
              <svg viewBox="0 0 32 32" aria-hidden="true">
                <circle
                  cx="16"
                  cy="16"
                  r="14"
                  class="foot-hold"
                  style={{ strokeDasharray: `${hud.prompt.hold01 * 88} 88` }}
                />
              </svg>
            )}
            {hud.prompt.key}
          </span>
          <span class="foot-label">{hud.prompt.label}</span>
          {!hud.prompt.ok && <span class="foot-why">{hud.prompt.why}</span>}
        </div>
      )}
      {hud.conduct && (
        <div class="foot-conduct" data-testid="foot-conduct" role="status">
          {hud.conduct}
        </div>
      )}
      <ol class="foot-belt" data-testid="foot-belt" aria-label="Tool belt">
        {hud.belt.map((s) => (
          <li
            key={s.id}
            class={`foot-slot${s.selected ? ' selected' : ''}${s.empty ? ' empty' : ''}`}
            data-tool={s.id}
            aria-current={s.selected ? 'true' : undefined}
          >
            <span class="foot-slot-key">{s.key}</span>
            <span class="foot-slot-name">{s.name}</span>
            {s.count && <span class="foot-slot-count">{s.count}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
