import { formatCents } from '../../sim/economy/knowledge';
import type { BackRoomLot, BackRoomSnapshot } from './back-room-model';
import { Help } from './Help';
import type { PortActions } from './PortScreen';
import { UpgradeTable } from './Shipyard';
import type { BackRoomGun } from './back-room-model';

/**
 * The back room after dark (plan 05 §6.2, §12 "Fence screen"; plan 10 §6; Phase 6 piece E).
 * The fence on the left: every lot in the hold with his rate, out of his cash for the week,
 * no detection risk. The shady shipwright beside him: guns, gun work and the rifle, fitted
 * tonight. Plan 13 §6: a plain click sells one CU, shift-click all his cash covers.
 */

function Ember() {
  return (
    <span class="ember" title="Hot: taken by crime" aria-label="hot">
      ◆
    </span>
  );
}

function lotNote(l: BackRoomLot): string {
  if (l.refusal) return l.refusal;
  if (l.maxQty <= 0) return "He hasn't the cash left for it";
  return `${l.ratePct}% of its value${l.offLine ? ' (not his line)' : ''}`;
}

function GunRow({
  gun,
  actions,
  setMessage,
}: {
  gun: BackRoomGun;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  return (
    <tr class="port-row" data-testid={`gun-row-${gun.id}`}>
      <td>
        {gun.name}
        <Help text={gun.blurb} />
      </td>
      <td class="num hud-num">{formatCents(gun.priceCents)}</td>
      <td class="port-dim">{gun.where}</td>
      <td class="port-actions">
        <button
          type="button"
          class="port-mini"
          data-testid={`buy-gun-${gun.id}`}
          disabled={!!gun.refusal}
          title={gun.refusal ?? 'Mount it on her'}
          onClick={() => setMessage(actions.buyGun?.(gun.id) ?? `${gun.name} mounted.`)}
        >
          {gun.refusal ? 'No' : 'Buy'}
        </button>
      </td>
    </tr>
  );
}

export function BackRoom({
  room,
  actions,
  setMessage,
}: {
  room: BackRoomSnapshot;
  actions: PortActions;
  setMessage(m: string | undefined): void;
}) {
  return (
    <>
      <div class="port-market back-room" data-testid="back-room" data-fence={room.fence}>
        <h3>
          {room.name}
          <Help text={room.blurb} />
        </h3>
        <p class="menu-note">
          In {room.where}. {room.wants}. {room.trustText}. He has{' '}
          <strong class="hud-num" data-testid="fence-cash">
            {formatCents(room.cashCents)}
          </strong>{' '}
          left to buy with this week, and nobody here asks where it came from.
        </p>
        {room.informRisk && (
          <p class="menu-note smuggler-inform" data-testid="fence-inform">
            The law is after you here, and he knows it: {room.informRisk} he sells you to the
            constable tonight.
          </p>
        )}
        {room.lots.length === 0 ? (
          <p class="port-dim">Your hold is empty.</p>
        ) : (
          <ul class="back-room-lots" data-testid="fence-lots">
            {room.lots.map((l) => (
              <li
                key={`${l.good}-${l.index}`}
                class={`${l.hot ? 'hot' : ''}${l.refusal ? ' refused' : ''}`}
                data-testid="fence-lot"
              >
                <span>
                  {l.hot && <Ember />} {l.name}
                </span>
                <span class="hud-num">{l.qty} CU</span>
                <small class="port-dim">
                  {lotNote(l)}
                  {l.unitCents !== undefined && !l.refusal && ` · ${formatCents(l.unitCents)} a CU`}
                </small>
                {!l.refusal && actions.fence ? (
                  <button
                    type="button"
                    class="port-mini"
                    data-testid={`fence-sell-${l.good}`}
                    disabled={l.maxQty <= 0}
                    title="Sell him one CU (shift-click: all his cash covers)"
                    onClick={(e) => setMessage(actions.fence?.(l.index, e.shiftKey ? l.maxQty : 1))}
                  >
                    Sell
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {room.shipwright && (
        <div class="port-hold yard back-room-yard" data-testid="shipwright">
          <h3>
            The shipwright
            <Help text="Guns are never sold over a counter. He fits them tonight, and the hours pass while he works. Guns and gun work move to a new hull if she has the slots; the hidden ports stay with the old one." />
          </h3>
          {room.guns && room.guns.length > 0 && (
            <table class="port-table" data-testid="shipwright-guns">
              <tbody>
                {room.guns.map((g) => (
                  <GunRow key={g.id} gun={g} actions={actions} setMessage={setMessage} />
                ))}
              </tbody>
            </table>
          )}
          <ul class="yard-slots">
            {room.shipwright.slots.map((s) => (
              <li key={s.category}>
                <span>{s.label}</span>
                <span class="hud-num">
                  {s.used}/{s.total}
                </span>
              </li>
            ))}
          </ul>
          <UpgradeTable
            rows={room.shipwright.upgrades}
            place="backRoom"
            actions={actions}
            setMessage={setMessage}
          />
        </div>
      )}
    </>
  );
}
