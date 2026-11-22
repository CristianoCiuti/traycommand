import type { Style } from '../../shared/config';
import aurora from './aurora/launcher.css?inline';
import terminal from './terminal/launcher.css?inline';
import brutal from './brutal/launcher.css?inline';
import neon from './neon/launcher.css?inline';

/**
 * Same in every look:
 *  - the search field takes all the room left, so the launcher shortcut sits at the end of the bar;
 *  - the search bar, the header of a form and the footer move the window. The whole search field
 *    (and what a look draws over it, like the block caret of Phosphor) is not a drag area, so the
 *    text typed can be selected with the mouse; buttons keep working.
 */
const COMMON = `
.lx-line { flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; }
.lx-line input { flex: 1; min-width: 0; width: 100%; }
.lx-search, .lx-head, .lx-foot { -webkit-app-region: drag; }
.lx-line, .lx-line *, .lx-search button, .lx-head button, .lx-foot button, .lx-foot a, .lx-foot select { -webkit-app-region: no-drag; }
`;

export const LAUNCHER_CSS: Record<Style, string> = { aurora: aurora + COMMON, terminal: terminal + COMMON, brutal: brutal + COMMON, neon: neon + COMMON };
