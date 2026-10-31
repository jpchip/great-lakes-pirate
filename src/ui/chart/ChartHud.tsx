import type { ReadonlySignal } from '@preact/signals';
import type { EncounterChoice } from '../../modes/chart';
import type { LookoutPref } from '../../sim/chart/traffic';
import { ChartLockedBanner } from '../hud/Hud';
import { LOOKOUT_LABELS, type ChartHudSnapshot } from './model';

/**
 * The chart's HUD (plan 13 §4.3, Phase 3 piece D): a logbook card top left with the date,
 * the wind, the course and its ETA and the plotting buttons; the lookout setting; the
 * encounter card low in the middle, so the contact stays in view; and the "chart locked"
 * banner. The chart itself is the canvas under it.
 */

export interface ChartHudActions {
  sail(): void;
  undo(): void;
  clear(): void;
  heaveTo(): void;
  back(): void;
  answer(choice: EncounterChoice): void;
  dismissNotice(): void;
  setLookout(pref: LookoutPref): void;
}

export function ChartHud({
  chart,
  actions,
}: {
  chart: ReadonlySignal<ChartHudSnapshot | undefined>;
  actions: ChartHudActions;
}) {
  const c = chart.value;
  if (!c) return null;
  const enc = c.encounter;
  return (
    <div class="chart-hud" data-testid="chart-hud" data-trip={c.trip}>
      {c.locked && <ChartLockedBanner />}
      <div class="chart-card chart-log" data-testid="chart-log">
        <div class="chart-kicker">{c.trip === 'look' ? 'The chart' : 'On the chart'}</div>
        <div class="chart-date">
          {c.dateText} · <span class="hud-num">{c.timeText}</span>
        </div>
        <div>
          {c.windText} · {c.lookoutText}
        </div>
        <div class="chart-status" data-testid="chart-status">
          {c.statusText}
        </div>
        {c.etaText && (
          <div class="chart-eta hud-num" data-testid="chart-eta">
            {c.etaText}
          </div>
        )}
        {c.problem && (
          <div class="chart-problem" data-testid="chart-problem">
            {c.problem}
          </div>
        )}
        <div class="chart-row">
          {!c.underWay && (
            <button
              type="button"
              class="menu-button primary"
              data-testid="chart-sail"
              disabled={!c.canSail}
              title={c.trip === 'sea' ? 'Enter' : undefined}
              onClick={actions.sail}
            >
              {c.sailLabel}
            </button>
          )}
          {!c.underWay && (
            <>
              <button
                type="button"
                class="menu-button"
                data-testid="chart-undo"
                disabled={!c.canEdit}
                title="Backspace"
                onClick={actions.undo}
              >
                Undo
              </button>
              <button
                type="button"
                class="menu-button"
                data-testid="chart-clear"
                disabled={!c.canEdit}
                onClick={actions.clear}
              >
                Clear
              </button>
            </>
          )}
          {c.underWay && (
            <button
              type="button"
              class="menu-button"
              data-testid="chart-heave"
              disabled={!c.canHeave}
              onClick={actions.heaveTo}
            >
              Heave to
            </button>
          )}
        </div>
        <label class="chart-row chart-lookout">
          <span>Lookouts report</span>
          <select
            data-testid="chart-lookout"
            value={c.lookout}
            onChange={(e) =>
              actions.setLookout((e.currentTarget as HTMLSelectElement).value as LookoutPref)
            }
          >
            {(Object.keys(LOOKOUT_LABELS) as LookoutPref[]).map((pref) => (
              <option key={pref} value={pref}>
                {LOOKOUT_LABELS[pref]}
              </option>
            ))}
          </select>
        </label>
        {c.backLabel && (
          <div class="chart-row">
            <button
              type="button"
              class="menu-button"
              data-testid="chart-back"
              onClick={actions.back}
            >
              {c.backLabel} <span class="hud-key">M</span>
            </button>
          </div>
        )}
        <div class="chart-help">
          Click to add waypoints (they snap to ports), drag to move them, right-click to remove,
          Shift-click to insert. Drag the chart to pan, wheel to zoom.
        </div>
      </div>
      {enc && (
        <div class="chart-card chart-encounter" data-testid="chart-encounter" role="dialog">
          <div class="chart-kicker">{enc.kind}</div>
          <div class="chart-encounter-name">{enc.name}</div>
          <p>{enc.text}</p>
          {enc.forcedText && <p class="chart-problem">{enc.forcedText}</p>}
          <div class="chart-row">
            <button
              type="button"
              class="menu-button primary"
              data-testid="encounter-engage"
              onClick={() => actions.answer('engage')}
            >
              {enc.engageLabel}
            </button>
            {enc.avoidLabel && (
              <button
                type="button"
                class="menu-button"
                data-testid="encounter-avoid"
                onClick={() => actions.answer('avoid')}
              >
                {enc.avoidLabel}
              </button>
            )}
            {enc.canIgnore && (
              <button
                type="button"
                class="menu-button"
                data-testid="encounter-ignore"
                onClick={() => actions.answer('ignore')}
              >
                Ignore
              </button>
            )}
          </div>
        </div>
      )}
      {c.notice && !enc && (
        <div class="chart-card chart-encounter" data-testid="chart-notice" role="status">
          <div class="chart-encounter-name">{c.notice.title}</div>
          <p>{c.notice.text}</p>
          <div class="chart-row">
            <button
              type="button"
              class="menu-button primary"
              data-testid="chart-notice-ok"
              onClick={actions.dismissNotice}
            >
              Very well
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
