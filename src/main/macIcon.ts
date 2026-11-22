import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/*
 * macOS: the icon of TrayCommand.app in Finder, Launchpad, Spotlight, dialogs and notifications
 * follows the look in use. The bundle's own icon (Contents/Resources) is never touched (that
 * would break its signature): the look's icon is set as a custom Finder icon, as "Get Info" does.
 */

/** JXA script: argv[0] the image, argv[1] the .app bundle. Arguments are never put in the code. */
const SCRIPT = `ObjC.import('AppKit');
function run(argv) {
  const image = $.NSImage.alloc.initWithContentsOfFile(argv[0]);
  if (!image || image.isNil()) return 'no image';
  return $.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, argv[1], 0) ? 'ok' : 'failed';
}`;

/** Custom icon file Finder keeps inside a folder (and so inside a bundle). */
export function customIconFile(bundle: string): string {
  return path.join(bundle, 'Icon\r');
}

/** Whether the bundle needs its icon set again (another look, or the icon was lost, e.g. after an update). */
export function bundleIconOutdated(bundle: string, style: string, applied: string | undefined): boolean {
  return applied !== style || !fs.existsSync(customIconFile(bundle));
}

/** Sets `image` (a PNG) as the Finder icon of `bundle`; resolves true when done. */
export function setBundleIcon(bundle: string, image: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT, image, bundle], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0 && out.trim() === 'ok'));
    } catch {
      resolve(false);
    }
  });
}
