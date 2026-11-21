import type { Style } from '../../shared/config';

/**
 * Shows a look: only its stylesheet is in the page, so nothing of another look can show through.
 * The stylesheets are bundled as text (one per look) and swapped in a single <style> element.
 */
export function applyStyle(style: Style, css: Record<Style, string>) {
  let el = document.getElementById('tc-style') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'tc-style';
    document.head.append(el);
  }
  if (el.dataset.style !== style) {
    el.textContent = css[style];
    el.dataset.style = style;
  }
  document.documentElement.dataset.style = style;
}

/** Title bar colours of the look in use (light or dark, as the page shows it). */
export function chromeColors(): { bg: string; fg: string } {
  const cs = getComputedStyle(document.documentElement);
  return { bg: cs.getPropertyValue('--chrome-bg').trim() || '#ffffff', fg: cs.getPropertyValue('--chrome-fg').trim() || '#000000' };
}
