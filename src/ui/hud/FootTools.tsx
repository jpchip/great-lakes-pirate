import type { FootToolsSnapshot } from './foot-tools-model';
import { keyName, keyText } from '../keys';
import type { Action } from '../../core/input';
import './foot-tools.css';

/**
 * The tool belt (1–5), the conduct line over it and the F prompt (plan 13 §4.2, plan 08
 * §12; Phase 7 piece E). A prompt that can't be done says why, in words, and is dimmed.
 */
/** A belt slot's key as bound now: slot "1" is the Tool1 key. */
function beltKey(slot: string): string {
  const n = Number(slot);
  return n >= 1 && n <= 9 ? keyName(`Tool${n}` as Action, 'onFoot') : slot;
}

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
            {keyText(hud.prompt.key, 'onFoot')}
          </span>
          <span class="foot-label">{keyText(hud.prompt.label, 'onFoot')}</span>
          {!hud.prompt.ok && <span class="foot-why">{keyText(hud.prompt.why, 'onFoot')}</span>}
        </div>
      )}
      {hud.load && (
        <div class="foot-load" data-testid="foot-load" role="status">
          {hud.load}
        </div>
      )}
      {hud.conduct && (
        <div class="foot-conduct" data-testid="foot-conduct" role="status">
          {hud.conduct}
        </div>
      )}
      <ol class="foot-belt" data-testid="foot-belt" aria-label="Tool belt">
        {hud.belt
          .filter((s) => !s.hidden)
          .map((s) => (
            <li
              key={s.id}
              class={`foot-slot${s.selected ? ' selected' : ''}${s.empty ? ' empty' : ''}`}
              data-tool={s.id}
              aria-current={s.selected ? 'true' : undefined}
            >
              <span class="foot-slot-key">{beltKey(s.key)}</span>
              <span class="foot-slot-name">{s.name}</span>
              {s.count && <span class="foot-slot-count">{s.count}</span>}
            </li>
          ))}
      </ol>
    </div>
  );
}
