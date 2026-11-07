import { render } from 'preact';

/** "Game already open in another tab" (plan 16 §4.4), in place of the menu. */
export function showTabLocked(root: HTMLElement): void {
  render(
    <div class="tab-locked" data-testid="tab-locked">
      <div class="title-card">
        <div class="title-kicker">Great Lakes Pirate</div>
        <h2>Already open in another tab</h2>
        <p>
          The run is being played in another tab or window. There is only ever one run, so it can
          only be open in one place: close this tab, or close the other one and reload.
        </p>
        <nav class="title-buttons">
          <button
            type="button"
            class="menu-button primary"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </nav>
      </div>
    </div>,
    root,
  );
}
