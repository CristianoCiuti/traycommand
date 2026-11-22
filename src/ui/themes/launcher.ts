import type { Style } from '../../shared/config';
import aurora from './aurora/launcher.css?inline';
import terminal from './terminal/launcher.css?inline';
import brutal from './brutal/launcher.css?inline';
import neon from './neon/launcher.css?inline';

/**
 * Same in every look: the search bar, the header of a form and the footer move the window
 * (what can be clicked or typed in them keeps working).
 */
const MOVE = `
.lx-search, .lx-head, .lx-foot { -webkit-app-region: drag; }
.lx-search input, .lx-search button, .lx-head button, .lx-foot button, .lx-foot a, .lx-foot select { -webkit-app-region: no-drag; }
`;

export const LAUNCHER_CSS: Record<Style, string> = { aurora: aurora + MOVE, terminal: terminal + MOVE, brutal: brutal + MOVE, neon: neon + MOVE };
