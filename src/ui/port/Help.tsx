/**
 * A small "?" that holds the explanation in its tooltip, so the page keeps to numbers
 * (Jared's note on the port screens: too much text). Focusable, so keys get it too.
 */
export function Help({ text, label = '?' }: { text: string; label?: string }) {
  return (
    <span class="port-help" title={text} aria-label={text} tabIndex={0}>
      {label}
    </span>
  );
}
