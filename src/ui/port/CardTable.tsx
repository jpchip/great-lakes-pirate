import { useEffect, useState } from 'preact/hooks';
import { formatCents } from '../../sim/economy/knowledge';
import type { BetAction } from '../../sim/poker/table';
import type { CardTableSnapshot, CardView, SeatView } from './cards-model';
import { Help } from './Help';
import type { PortActions } from './PortScreen';

/**
 * The card table (plan 13 §5 "Poker table"; Phase 9 piece C): the captains across the
 * baize with their stacks, their tells and, at the showdown, their cards; the shown pot and
 * any side stake in the middle; your five cards below, clicked to throw away at the draw;
 * and the betting, the draw and the palmed card beside them. Every suit wears its glyph as
 * well as its color (plan 13 §2.2).
 */

function PlayingCard({
  card,
  marked,
  onClick,
  testid,
}: {
  card: CardView | undefined;
  marked?: boolean | undefined;
  onClick?: (() => void) | undefined;
  testid?: string | undefined;
}) {
  if (!card) {
    return <span class="playing-card back" aria-label="a card, face down" data-testid={testid} />;
  }
  const cls = `playing-card${card.red ? ' red' : ''}${marked ? ' marked' : ''}`;
  const inner = (
    <>
      <span class="playing-card-rank">{card.rank}</span>
      <span class="playing-card-suit">{card.suit}</span>
    </>
  );
  if (!onClick) {
    return (
      <span class={cls} title={card.name} aria-label={card.name} data-testid={testid}>
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      class={cls}
      title={marked ? `Keep ${card.name}` : `Throw away ${card.name}`}
      aria-label={card.name}
      aria-pressed={marked}
      data-testid={testid}
      onClick={onClick}
    >
      {inner}
      {marked && <span class="playing-card-mark">Discard</span>}
    </button>
  );
}

function Seat({ seat }: { seat: SeatView }) {
  const status =
    seat.status === 'gone'
      ? 'Gone up to bed'
      : seat.status === 'folded'
        ? 'Folded'
        : seat.drew !== undefined
          ? seat.drew === 0
            ? 'Stood pat'
            : `Drew ${seat.drew}`
          : '';
  return (
    <div
      class={`card-seat ${seat.status}${seat.won ? ' won' : ''}`}
      data-testid={`card-seat-${seat.id}`}
      data-status={seat.status}
    >
      <div class="card-seat-name">{seat.name}</div>
      <div class="card-seat-ship port-dim">of {seat.ship}</div>
      <div class="card-seat-cards">
        {seat.status === 'gone' || seat.status === 'idle' || seat.status === 'folded'
          ? null
          : (seat.cards ?? [undefined, undefined, undefined, undefined, undefined]).map((c, i) => (
              <PlayingCard key={i} card={c} />
            ))}
      </div>
      <div class="card-seat-stack hud-num">{formatCents(seat.stackCents)}</div>
      {seat.shown && (
        <div class="card-seat-shown" data-testid="card-seat-shown">
          {seat.won ? '★ ' : ''}
          {seat.shown}
        </div>
      )}
      {status && <div class="port-dim card-seat-status">{status}</div>}
      {seat.tell && (
        <div class="card-seat-tell" data-testid="card-tell">
          He {seat.tell}.
        </div>
      )}
      {seat.marker && (
        <div class="card-seat-marker" data-testid="card-marker">
          Holds up {seat.marker}
        </div>
      )}
    </div>
  );
}

const BET_LABELS: Record<BetAction, string> = {
  check: 'Check',
  bet: 'Bet',
  call: 'Call',
  raise: 'Raise',
  fold: 'Fold',
};

export function CardTable({
  table,
  actions,
  setMessage,
}: {
  table: CardTableSnapshot;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  const [discards, setDiscards] = useState<number[]>([]);
  const [palm, setPalm] = useState(false);
  const [stake, setStake] = useState<string>('');
  // A new hand or a new phase clears the marks.
  useEffect(() => {
    setDiscards([]);
    setPalm(false);
  }, [table.hands, table.phase]);
  const drawing = table.phase === 'draw' && !table.you.folded;
  const hasAce = table.you.cards.some((c, i) => c.rank === 'A' && !discards.includes(i));
  const maxDraw = table.maxDraw + (hasAce ? 1 : 0);
  const toggle = (i: number): void => {
    if (discards.includes(i)) setDiscards(discards.filter((d) => d !== i));
    else if (discards.length < maxDraw) setDiscards([...discards, i]);
  };
  const between = table.phase === 'idle' || table.phase === 'done';
  const amount = (a: BetAction): string =>
    a === 'call'
      ? ` ${formatCents(table.callCents)}`
      : a === 'bet' || a === 'raise'
        ? ` ${formatCents(table.betCents)}`
        : '';

  return (
    <div class="card-table" data-testid="card-table" data-phase={table.phase}>
      <p class="menu-note">
        Five-card draw at {formatCents(table.anteCents)} a hand
        {table.big ? ', and tonight the stakes are high' : ''}. Bets are{' '}
        {formatCents(table.anteCents * 2)} before the draw and {formatCents(table.anteCents * 4)}{' '}
        after.{' '}
        <span class="port-dim">
          Hand {Math.min(table.hands, table.handsPerNight)} of {table.handsPerNight} tonight ·
          You're{' '}
          <span class="hud-num" data-testid="card-net">
            {table.netCents >= 0 ? 'up' : 'down'} {formatCents(Math.abs(table.netCents))}
          </span>
        </span>
      </p>
      <div class="card-baize">
        <div class="card-seats">
          {table.seats.map((s) => (
            <Seat key={s.id} seat={s} />
          ))}
        </div>
        <div class="card-pot" data-testid="card-pot">
          {table.potCents > 0 ? (
            <>
              Pot <strong class="hud-num">{formatCents(table.potCents)}</strong>
            </>
          ) : (
            <span class="port-dim">No hand dealt</span>
          )}
          {table.side && (
            <div class="card-side" data-testid="card-side">
              Side stake with {table.side.captain}: {table.side.his}, against {table.side.yours}
            </div>
          )}
        </div>
        <div class="card-yours">
          <div class="card-hand" data-testid="card-hand">
            {table.you.cards.map((c, i) => (
              <PlayingCard
                key={i}
                card={c}
                marked={drawing && discards.includes(i)}
                onClick={drawing ? () => toggle(i) : undefined}
                testid={`card-${i}`}
              />
            ))}
          </div>
          {table.you.hand && (
            <div class="card-hand-name" data-testid="card-hand-name">
              {table.you.folded ? 'Folded: ' : ''}
              {table.you.hand}
            </div>
          )}
        </div>
      </div>

      <div class="card-controls">
        {(table.phase === 'bet1' || table.phase === 'bet2') && !table.you.folded && (
          <div class="card-row">
            {table.options.map((a) => (
              <button
                type="button"
                key={a}
                class={`menu-button${a === 'call' || a === 'check' ? ' primary' : ''}`}
                data-testid={`card-${a}`}
                onClick={() => setMessage(actions.pokerBet?.(a))}
              >
                {BET_LABELS[a]}
                {amount(a)}
              </button>
            ))}
          </div>
        )}
        {drawing && (
          <div class="card-row">
            <button
              type="button"
              class="menu-button primary"
              data-testid="card-draw"
              onClick={() => setMessage(actions.pokerDraw?.(discards, palm))}
            >
              {discards.length === 0 ? 'Stand pat' : `Draw ${discards.length}`}
            </button>
            <label class="card-palm" data-testid="card-palm-label">
              <input
                type="checkbox"
                data-testid="card-palm"
                checked={palm}
                onChange={(e) => setPalm((e.target as HTMLInputElement).checked)}
              />{' '}
              Palm a card from your sleeve ({table.sleight.word})
              <Help text="A sleight of hand: the card you need comes out of your sleeve. The sharper the eyes still in the hand, and the more you've tried it tonight, the likelier someone sees. Caught, it's a beating or a brawl, and you're barred from this table." />
            </label>
            <span class="port-dim">
              Click the cards to throw away, up to {maxDraw}
              {hasAce ? ' (you keep an ace)' : ''}.
            </span>
          </div>
        )}
        {table.phase === 'caught' && (
          <div class="card-row card-caught" data-testid="card-caught">
            <p>
              <strong>{table.caughtBy ?? 'Somebody'} has your wrist.</strong> The card's on the
              table between you, and the room has gone quiet.
            </p>
            <button
              type="button"
              class="menu-button"
              data-testid="card-licking"
              onClick={() => setMessage(actions.pokerCaught?.('licking'))}
            >
              Take your licking
            </button>
            <button
              type="button"
              class="menu-button"
              data-testid="card-swing"
              onClick={() => setMessage(actions.pokerCaught?.('swing'))}
            >
              Swing first (assault)
            </button>
          </div>
        )}
        {between && !table.over && (
          <div class="card-row">
            {table.offer && (
              <div class="card-offer" data-testid="card-offer">
                <p>
                  {table.offer.captain} will put up <strong>{table.offer.label}</strong> (about{' '}
                  {formatCents(table.offer.valueCents)}) on the next hand, if you'll match it. The
                  better hand of the two of you takes both; fold and it's his.
                </p>
                <select
                  data-testid="card-stake"
                  value={stake}
                  onChange={(e) => setStake((e.target as HTMLSelectElement).value)}
                >
                  <option value="">Not this hand</option>
                  {table.offer.options.map((o) => (
                    <option key={o.key} value={o.key} disabled={!!o.refusal}>
                      Match with {o.label}
                      {o.refusal ? ` (${o.refusal})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              class="menu-button primary"
              data-testid="card-deal"
              disabled={!!table.dealRefusal}
              title={table.dealRefusal}
              onClick={() => {
                setMessage(actions.pokerDeal?.(stake || undefined));
                setStake('');
              }}
            >
              Deal me in ({formatCents(table.anteCents)})
            </button>
            {table.dealRefusal && <span class="port-dim">{table.dealRefusal}</span>}
          </div>
        )}
        {table.over && table.phase !== 'caught' && (
          <p class="menu-note" data-testid="card-over">
            {table.over}
          </p>
        )}
        {table.log.length > 0 && (
          <ol class="card-log" data-testid="card-log">
            {table.log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
