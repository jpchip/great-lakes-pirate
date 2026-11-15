import type { JailActions, JailSnapshot } from './model';

/**
 * The jail screens (plan 13 §12 Phase 5, plan 12 §8.1; piece D), on logbook paper like the
 * other screens. The cell: what was taken, the sentence and when you're out, bail by
 * sending word to a strongbox, and the jailbreak that night (Phase 7 piece G). At tier 5
 * the gallows: the ONE CHANCE jailbreak is the only way out, and once had there's only the
 * rope. The release: how you got out and "While you were inside...".
 */
export function JailScreen({ jail, actions }: { jail: JailSnapshot; actions: JailActions }) {
  if (jail.kind === 'released') {
    return (
      <div class="menu-backdrop jail-backdrop" data-testid="jail-screen" data-kind="released">
        <div class="menu jail" role="dialog" aria-modal="true" aria-label={jail.title}>
          <header class="menu-header">
            <h2>{jail.title}</h2>
          </header>
          <p class="jail-lead" data-testid="jail-lead">
            {jail.lead}
          </p>
          {jail.inside.length > 0 && (
            <>
              <h3 class="jail-heading">{jail.heading ?? 'While you were inside...'}</h3>
              <ul class="jail-list" data-testid="jail-inside">
                {jail.inside.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          )}
          <p class="jail-ship">{jail.ship}</p>
          <footer class="menu-footer">
            <button
              type="button"
              class="menu-button primary"
              data-testid="jail-leave"
              onClick={actions.leave}
            >
              {jail.leaveLabel ?? 'Back aboard'}
            </button>
          </footer>
        </div>
      </div>
    );
  }
  if (jail.kind === 'gallows') {
    return (
      <div
        class="menu-backdrop jail-backdrop gallows"
        data-testid="jail-screen"
        data-kind="gallows"
      >
        <div class="menu jail" role="dialog" aria-modal="true" aria-label="Sentenced to hang">
          <header class="menu-header">
            <h2>Sentenced to hang</h2>
            <span class="menu-paused">{jail.lockup}</span>
          </header>
          <p class="jail-lead">
            {jail.taken}. The region had you Most Wanted: there's no sentence to serve and no bail
            to post. You hang at dawn.
          </p>
          <h3 class="jail-heading">Taken from you</h3>
          <ul class="jail-list" data-testid="jail-confiscated">
            {jail.confiscated.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <div class="jail-option jail-break">
            {jail.canBreakOut && (
              <p class="jail-banner" data-testid="jail-one-chance">
                ONE CHANCE
              </p>
            )}
            <p
              class={jail.canBreakOut ? 'jail-note' : 'jail-note bad'}
              data-testid="jail-break-note"
            >
              {jail.jailbreak}
            </p>
            <button
              type="button"
              class="menu-button"
              data-testid="jail-break"
              disabled={!jail.canBreakOut}
              onClick={actions.jailbreak}
            >
              Attempt the jailbreak
            </button>
          </div>
          <footer class="menu-footer">
            <button
              type="button"
              class="menu-button danger"
              data-testid="jail-hang"
              onClick={actions.hang}
            >
              Face the rope
            </button>
          </footer>
        </div>
      </div>
    );
  }
  return (
    <div class="menu-backdrop jail-backdrop" data-testid="jail-screen" data-kind="cell">
      <div class="menu jail" role="dialog" aria-modal="true" aria-label="In the lockup">
        <header class="menu-header">
          <h2>In {jail.lockup}</h2>
          <span class="menu-paused">{jail.tierName}</span>
        </header>
        <p class="jail-lead">{jail.taken}.</p>
        <div class="jail-columns">
          <section>
            <h3 class="jail-heading">Taken from you</h3>
            <ul class="jail-list" data-testid="jail-confiscated">
              {jail.confiscated.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
          <section>
            <h3 class="jail-heading">The sentence</h3>
            <dl class="jail-facts">
              <dt>Time</dt>
              <dd data-testid="jail-sentence">
                {jail.sentenceWeeks} week{jail.sentenceWeeks === 1 ? '' : 's'}
              </dd>
              <dt>Out</dt>
              <dd>{jail.releaseText.replace(/^Out /, '')}</dd>
              {jail.minor ? (
                <>
                  <dt>The ship</dt>
                  <dd>Left alone at her pier</dd>
                </>
              ) : (
                <>
                  <dt>The ship</dt>
                  <dd>Impounded: {jail.impound} to get her back</dd>
                  <dt>Bail</dt>
                  <dd data-testid="jail-bail">{jail.bail}</dd>
                </>
              )}
            </dl>
          </section>
        </div>

        {!jail.minor && (
          <div class="jail-option">
            <h3 class="jail-heading">Send word for bail</h3>
            <p class="jail-note">
              A messenger takes bail, the ship's fee and a {jail.wordFee} fee ({jail.wordTotal} in
              all) from a strongbox. You're out when the money comes, but bail doesn't clear your
              name.
            </p>
            {jail.wordSent && <p class="jail-note">{jail.wordSent}</p>}
            <div class="jail-word">
              {jail.wordOptions.map((o) => (
                <button
                  key={o.hideout}
                  type="button"
                  class="menu-button"
                  data-testid={`jail-word-${o.hideout}`}
                  disabled={!o.enough || !!jail.wordSent}
                  onClick={() => actions.sendWord(o.hideout)}
                >
                  Send word to {o.name} <small class="port-dim">({o.cash})</small>
                </button>
              ))}
            </div>
            {jail.wordRefusal && <p class="jail-note bad">{jail.wordRefusal}</p>}
          </div>
        )}

        <div class="jail-option jail-break">
          <h3 class="jail-heading">Break out</h3>
          {jail.breakoutNote && (
            <p class="jail-note bad" data-testid="jail-break-last">
              {jail.breakoutNote}
            </p>
          )}
          <p class="jail-note" data-testid="jail-break-note">
            {jail.jailbreak}
          </p>
          <button
            type="button"
            class="menu-button"
            data-testid="jail-break"
            disabled={!jail.canBreakOut}
            onClick={actions.jailbreak}
          >
            Attempt a jailbreak tonight
          </button>
        </div>

        <footer class="menu-footer">
          <button
            type="button"
            class="menu-button primary"
            data-testid="jail-serve"
            onClick={actions.serve}
          >
            Serve the sentence
          </button>
        </footer>
      </div>
    </div>
  );
}
