import type { ReadonlySignal } from '@preact/signals';
import type { HailForecast } from './hail-forecast';

/**
 * A law ship's hail and what it comes to: heave to, or run. Logbook paper at the top
 * left of the helm while she's after you.
 */
export function HailForecastView({ card }: { card: ReadonlySignal<HailForecast | undefined> }) {
  const c = card.value;
  if (!c) return null;
  return (
    <aside class="hail-forecast" data-testid="hail-forecast" data-by={c.by} aria-live="polite">
      <h2 class="hail-forecast-title">{c.title}</h2>
      <div class="hail-forecast-standing">{c.standing}</div>
      {[c.heaveTo, c.run].map((choice) => (
        <section class="hail-forecast-choice" key={choice.head}>
          <h3>{choice.head}</h3>
          <ul>
            {choice.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
