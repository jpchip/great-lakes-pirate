import type { Settings } from '../core/settings';

/**
 * Puts the interface's accessibility settings (plan 13 §9) on the page: the UI scale as
 * `--ui-scale`, and the plain font, the colour-blind palette and reduced motion as data
 * attributes on <html> that theme.css reads. Called before the main menu shows and again on
 * every change.
 */
export function applyAccess(access: Settings['access'], root: HTMLElement): void {
  root.style.setProperty('--ui-scale', String(access.uiScale));
  if (access.plainFont) root.dataset['font'] = 'plain';
  else delete root.dataset['font'];
  if (access.colorMode !== 'off') root.dataset['colorMode'] = access.colorMode;
  else delete root.dataset['colorMode'];
  if (access.reduceMotion) root.dataset['reduceMotion'] = '';
  else delete root.dataset['reduceMotion'];
}

/** The warning red as the palette has it now, for what draws on a canvas (the chart). */
export function signalRed(root: HTMLElement): string | undefined {
  const value = getComputedStyle(root).getPropertyValue('--signal-red').trim();
  return value || undefined;
}
