import type { ReadonlySignal } from '@preact/signals';
import type { AimHudSnapshot, TargetCardSnapshot } from '../../gameplay/aim';

/**
 * The aim HUD (plan 13 §4.1, 07 §3; Phase 6 piece B): along the bottom middle, the gun
 * laid and its shot, the range, what's stopping it, a load ring per mount, the powder
 * left, the barrel's roll (fire as it comes down), and "Steering locked" on a T1.
 */
export function AimHud({ aim }: { aim: ReadonlySignal<AimHudSnapshot | undefined> }) {
  const a = aim.value;
  if (!a) return null;
  const ready = a.status === 'ready';
  const warn = a.status === 'noPowder' || a.status === 'pastSight' || a.status === 'beyondReach';
  return (
    <div class="aim-hud" data-testid="aim-hud" data-weapon={a.weapon} data-status={a.status}>
      <div class="aim-hud-row">
        <span class="aim-hud-title" data-testid="aim-title">
          {a.title}
        </span>
        <span class="aim-hud-ammo" data-testid="aim-ammo">
          {a.ammoChoices.map((c) => (
            <span key={c.id} class={`aim-hud-shot${c.selected ? ' selected' : ''}`}>
              {c.name}
            </span>
          ))}
          <span class="hud-key">C</span>
        </span>
      </div>
      <div class="aim-hud-row">
        <span
          class={`hud-chip aim-hud-status${ready ? ' ready' : warn ? ' danger' : ''}`}
          data-testid="aim-status"
        >
          {a.statusText}
        </span>
        <span class="hud-num aim-hud-range" data-testid="aim-range">
          {Math.round(a.rangeM)} m <small>of {Math.round(a.reachM)}</small>
        </span>
        <span
          class={`aim-hud-tilt${a.falling ? ' falling' : ''}`}
          data-testid="aim-tilt"
          title="The barrel's tilt off the sight with the roll: fire as it comes down"
        >
          {a.falling ? '▼' : '▲'} <span class="hud-num">{a.tiltDeg.toFixed(1)}°</span>
        </span>
        <span class="hud-num aim-hud-powder" data-testid="aim-powder">
          Powder {a.charges}
        </span>
      </div>
      <div class="aim-hud-row aim-hud-loads">
        {a.reloads.map((r) => (
          <span
            key={r.mount}
            class={`aim-load${r.ready01 >= 1 ? ' ready' : ''}`}
            data-testid={`aim-load-${r.mount}`}
            style={{ '--load': `${Math.round(Math.max(0, Math.min(1, r.ready01)) * 360)}deg` }}
          >
            <span class="aim-load-ring" />
            {r.label}
          </span>
        ))}
        {a.steeringLocked && (
          <span class="hud-chip danger" data-testid="aim-steering-locked">
            Steering locked
          </span>
        )}
      </div>
      <div class="aim-hud-keys">
        <span class={a.weapon === 'swivel' ? 'on' : a.available.swivel ? '' : 'off'}>
          <span class="hud-key">1</span> Swivel
        </span>
        <span class={a.weapon === 'broadside' ? 'on' : a.available.broadside ? '' : 'off'}>
          <span class="hud-key">2</span> Broadside
        </span>
        <span class={a.weapon === 'rifle' ? 'on' : a.available.rifle ? '' : 'off'}>
          <span class="hud-key">3</span> Rifle
        </span>
        <span>
          <span class="hud-key">LMB</span> Fire
        </span>
        <span>
          <span class="hud-key">Tab</span> Stand down
        </span>
      </div>
    </div>
  );
}

function CardBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div class={`target-card-bar${v < 0.3 ? ' danger' : ''}`}>
      <span>{label}</span>
      <span class="target-card-track">
        <span class="target-card-fill" style={{ transform: `scaleX(${v.toFixed(3)})` }} />
      </span>
    </div>
  );
}

/**
 * The target card (plan 13 §4.5): the ship under the gun, her name, class and crew, her
 * captain's nerve and why, her damage, and whether she's struck.
 */
export function TargetCardView({ card }: { card: ReadonlySignal<TargetCardSnapshot | undefined> }) {
  const c = card.value;
  if (!c) return null;
  return (
    <aside class="target-card" data-testid="target-card" data-ship={c.shipId} data-phase={c.phase}>
      <h2 class="target-card-title">{c.name}</h2>
      <div class="target-card-sub">
        {c.className} · {Math.round(c.rangeM)} m
      </div>
      <div class={`target-card-phase${c.struck ? ' struck' : ''}`} data-testid="target-card-phase">
        {c.struck && <span class="target-card-flag" aria-hidden="true" />}
        {c.phaseLabel}
        {c.foundering && ' · foundering'}
      </div>
      {c.morale !== undefined && (
        <div class="target-card-morale" data-testid="target-card-morale">
          <CardBar label="Nerve" value={c.morale / 100} />
          {c.why && <div class="target-card-why">{c.why}</div>}
        </div>
      )}
      <CardBar label="Hull" value={c.hull01} />
      <CardBar label="Rig" value={c.rigging01} />
      {c.engine01 !== undefined && <CardBar label="Engine" value={c.engine01} />}
      <div class="target-card-crew" data-testid="target-card-crew">
        Crew {c.crew}
        {c.killed > 0 && <span class="target-card-dead"> · {c.killed} killed</span>}
        {c.wounded > 0 && <span> · {c.wounded} wounded</span>}
      </div>
      {c.towParted !== undefined && (
        <div class="target-card-tow">{c.towParted ? 'Hawser parted' : 'Under tow'}</div>
      )}
    </aside>
  );
}
