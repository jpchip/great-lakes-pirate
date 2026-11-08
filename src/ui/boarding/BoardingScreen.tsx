import { formatCents } from '../../sim/economy/knowledge';
import { pct, type BoardingActions, type BoardingSnapshot } from './model';

/**
 * Boarding a prize (plan 07 §6, §7; plan 13; Phase 6 piece D), on the port screen's ledger
 * paper. Three stages: the boarding panel (your strength against hers, Intimidate, Fight,
 * Withdraw, with the odds and the death chance shown before you commit); her hold against
 * yours (valuables first, the time each lot takes, a quick grab); and what to do with her
 * and her crew. Shift-click takes all of a lot that fits.
 */

function minutesText(m: number): string {
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h} h ${r} min` : `${h} h`;
}

function Panel({ b, actions }: { b: BoardingSnapshot; actions: BoardingActions }) {
  const o = b.odds;
  return (
    <>
      <p class="menu-note">
        {b.crew} hands aboard her
        {b.wounded > 0 ? `, ${b.wounded} of them wounded` : ''}
        {b.killed > 0 ? `; ${b.killed} dead on her deck` : ''}. Her crew's nerve:{' '}
        <strong class="hud-num">{b.morale}</strong> of 100.
      </p>
      <div class="board-sides">
        <table class="port-table" data-testid="boarding-strength">
          <thead>
            <tr>
              <th>Your strength</th>
              <th class="num">{o.strength}</th>
            </tr>
          </thead>
          <tbody>
            {o.parts.map((p) => (
              <tr key={p.label}>
                <td>{p.label}</td>
                <td class="num hud-num">{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table class="port-table">
          <thead>
            <tr>
              <th>Her defense</th>
              <th class="num">{o.defense}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Her able hands, her nerve</td>
              <td class="num hud-num">{o.defense}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="board-options">
        <button
          type="button"
          class="board-option"
          data-testid="board-intimidate"
          disabled={b.intimidateTried}
          onClick={() => actions.intimidate()}
        >
          <strong>Intimidate</strong>
          <span class="hud-num">{pct(o.intimidate)}</span>
          <small>Call on her to strike. No one hurt if she does.</small>
        </button>
        <button
          type="button"
          class="board-option danger"
          data-testid="board-fight"
          onClick={() => actions.fight()}
        >
          <strong>Fight</strong>
          <span class="hud-num">{pct(o.fight)}</span>
          <small>
            Carry her deck. Her people will be killed and hurt.
            {o.death > 0 ? (
              <>
                {' '}
                <em class="board-death" data-testid="board-death">
                  If you're beaten off, a {pct(o.death)} chance you die.
                </em>
              </>
            ) : (
              ' Beaten off, you take damage and sheer off.'
            )}
          </small>
        </button>
        <button
          type="button"
          class="board-option"
          data-testid="board-withdraw"
          onClick={() => actions.withdraw()}
        >
          <strong>Withdraw</strong>
          <span class="hud-num">—</span>
          <small>Cast off and leave her be.</small>
        </button>
      </div>
    </>
  );
}

function Loot({ b, actions }: { b: BoardingSnapshot; actions: BoardingActions }) {
  const l = b.loot;
  if (!l) return null;
  const free = Math.max(0, l.capacity - l.usedCu);
  return (
    <>
      <p class="menu-note">
        Valuables first. Every CU you swing across takes time
        {l.inSight > 0
          ? `, and ${l.inSight} ship${l.inSight === 1 ? ' is' : 's are'} in sight of you.`
          : '. Nobody else is in sight, for now.'}{' '}
        Everything you take is hot{b.ownerName ? `, with ${b.ownerName}'s marks on it` : ''}.
      </p>
      <div class="port-body">
        <div class="port-market">
          <table class="port-table" data-testid="loot-lots">
            <thead>
              <tr>
                <th>Aboard her</th>
                <th class="num">CU</th>
                <th class="num">Each</th>
                <th class="num">Time a CU</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {l.lots.length === 0 && (
                <tr>
                  <td colSpan={5} class="port-dim">
                    Nothing left worth taking.
                  </td>
                </tr>
              )}
              {l.lots.map((lot) => (
                <tr key={lot.key} class="port-row" data-testid="loot-lot">
                  <td>
                    {lot.quick && (
                      <span class="ember" title="Valuable: a quick grab takes it">
                        ◆
                      </span>
                    )}{' '}
                    {lot.name}
                  </td>
                  <td class="num hud-num">{lot.key === 'cash' ? '' : lot.qty}</td>
                  <td class="num hud-num">{formatCents(lot.cents ?? lot.unitCents)}</td>
                  <td class="num hud-num">{minutesText(lot.minutesPerCu)}</td>
                  <td class="port-actions">
                    <button
                      type="button"
                      class="port-mini"
                      data-testid={`loot-take-${lot.key}`}
                      disabled={lot.key !== 'cash' && free <= 0}
                      title="Take one CU (shift-click: all that fits)"
                      onClick={(e) => actions.take(lot.key, e.shiftKey ? lot.qty : 1)}
                    >
                      Take
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside class="port-hold">
          <h3>Your hold</h3>
          <p class="hud-num" data-testid="loot-hold">
            {l.usedCu} / {l.capacity} CU
          </p>
          <p class="port-dim">
            Taken: <span class="hud-num">{l.takenCu} CU</span>
            {l.takenCents > 0 ? ` and ${formatCents(l.takenCents)}` : ''}
          </p>
          <p class="port-dim">
            Aboard her: <span class="hud-num">{minutesText(l.minutes)}</span>
          </p>
          <p class="port-dim">
            Purse <strong class="hud-num">{formatCents(l.purseCents)}</strong>
          </p>
        </aside>
      </div>
      <div class="board-footer">
        <button
          type="button"
          class="port-mini"
          data-testid="loot-quick"
          title="The cash box and the valuables that fit, at once"
          onClick={() => actions.quickGrab()}
        >
          Quick grab and go
        </button>
        <button
          type="button"
          class="port-mini primary"
          data-testid="loot-done"
          onClick={() => actions.doneLooting()}
        >
          Done with her hold
        </button>
      </div>
    </>
  );
}

function Aftermath({ b, actions }: { b: BoardingSnapshot; actions: BoardingActions }) {
  const a = b.aftermath;
  if (!a) return null;
  return (
    <>
      <p class="menu-note">
        What becomes of her and her {b.crew} hands? {a.weatherText}
      </p>
      <div class="board-options aftermath" data-testid="aftermath">
        {a.options.map((o) => (
          <button
            key={o.choice}
            type="button"
            class={`board-option${o.deathChance > 0 ? ' danger' : ''}`}
            data-testid={`aftermath-${o.choice}`}
            onClick={() => actions.choose(o.choice)}
          >
            <strong>{o.label}</strong>
            <small>{o.text}</small>
            <small class="board-report">Report to the law: {o.reportText}.</small>
            {o.allHands ? (
              <em class="board-death">Every hand aboard dies.</em>
            ) : o.deathChance > 0 ? (
              <em class="board-death">The boat: a {pct(o.deathChance)} chance of drowning.</em>
            ) : o.choice === 'adrift' ? (
              <small>Fair weather: the boat will make shore.</small>
            ) : null}
          </button>
        ))}
      </div>
    </>
  );
}

const TITLES = {
  panel: 'Alongside',
  loot: 'Her hold',
  aftermath: 'Her crew',
} as const;

export function BoardingScreen({
  boarding: b,
  actions,
}: {
  boarding: BoardingSnapshot;
  actions: BoardingActions;
}) {
  return (
    <div class="menu-backdrop" data-testid="boarding-screen" data-stage={b.stage}>
      <div class="menu port boarding" role="dialog" aria-modal="true" aria-label={b.shipName}>
        <header class="menu-header">
          <h2>
            {TITLES[b.stage]}: <em>{b.shipName}</em>
          </h2>
          <span class="port-purse">
            {b.className}
            {b.ownerName ? `, ${b.ownerName}` : ''}
            {b.struck ? ' · under a white flag' : ''}
          </span>
        </header>
        {b.message && (
          <p class="port-message" role="status" data-testid="boarding-message">
            {b.message}
          </p>
        )}
        {b.stage === 'panel' && <Panel b={b} actions={actions} />}
        {b.stage === 'loot' && <Loot b={b} actions={actions} />}
        {b.stage === 'aftermath' && <Aftermath b={b} actions={actions} />}
      </div>
    </div>
  );
}
