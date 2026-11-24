import { render } from 'preact';

/**
 * "Built for a keyboard and mouse": shown on a phone or tablet before the menu. The
 * player can carry on anyway; the promise settles when they do.
 */
export function showMobileWarning(root: HTMLElement, onContinue: () => void): Promise<void> {
  return new Promise((resolve) => {
    render(
      <div
        class="mobile-warning"
        data-testid="mobile-warning"
        role="alertdialog"
        aria-labelledby="mobile-warning-title"
      >
        <div class="title-card">
          <div class="title-kicker">Great Lakes Pirate</div>
          <h2 id="mobile-warning-title">Best played at a desk</h2>
          <p>
            This game is built for a desktop or laptop with a keyboard and mouse. You steer, aim and
            walk with the keys and look about with the mouse, and there are no touch controls yet,
            so on a phone or tablet you won't get far.
          </p>
          <p class="menu-note">If you have a keyboard and mouse connected, you can carry on.</p>
          <nav class="title-buttons">
            <button
              type="button"
              class="menu-button primary"
              data-testid="mobile-warning-continue"
              onClick={() => {
                onContinue();
                render(null, root);
                resolve();
              }}
            >
              Continue anyway
            </button>
          </nav>
        </div>
      </div>,
      root,
    );
  });
}
