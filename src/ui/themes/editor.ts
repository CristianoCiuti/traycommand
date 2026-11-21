import type { Style } from '../../shared/config';
import aurora from './aurora/styles.css?inline';
import terminal from './terminal/styles.css?inline';
import brutal from './brutal/styles.css?inline';
import neon from './neon/styles.css?inline';

export const EDITOR_CSS: Record<Style, string> = { aurora, terminal, brutal, neon };
