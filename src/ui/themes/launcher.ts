import type { Style } from '../../shared/config';
import aurora from './aurora/launcher.css?inline';
import terminal from './terminal/launcher.css?inline';
import brutal from './brutal/launcher.css?inline';
import neon from './neon/launcher.css?inline';

export const LAUNCHER_CSS: Record<Style, string> = { aurora, terminal, brutal, neon };
