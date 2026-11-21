import { nativeImage, type NativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const cache = new Map<string, { mtime: number; image: NativeImage }>();

function load(file: string): NativeImage | undefined {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = cache.get(file);
    if (hit && hit.mtime === mtime) return hit.image;
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) return undefined;
    cache.set(file, { mtime, image });
    return image;
  } catch {
    return undefined;
  }
}

/** Image with 1x and 2x representations at `size` logical pixels (crisp on HiDPI). */
export function sizedIcon(file: string | undefined, size: number): NativeImage | undefined {
  if (!file) return undefined;
  const source = load(file);
  if (!source) return undefined;
  const result = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const px = Math.round(size * scale);
    const resized = source.resize({ width: px, height: px, quality: 'best' });
    result.addRepresentation({ scaleFactor: scale, width: px, height: px, buffer: resized.toPNG() });
  }
  return result;
}

export function assetPath(...parts: string[]): string {
  // dist/main/main.cjs → <root>/assets in dev, resources/assets when packaged
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'assets', ...parts) : '';
  if (packaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', '..', 'assets', ...parts);
}

/** The look in use: the app icon (window, taskbar, TrayCommand tray icon) is the one of that look. */
let iconStyle = 'aurora';
export function setIconStyle(style: string) {
  iconStyle = style;
}

/** File of the app icon of the look in use. */
export function appIconFile(style = iconStyle): string {
  const own = assetPath(`icon-${style}.png`);
  return fs.existsSync(own) ? own : assetPath('icon.png');
}

export function appIcon(size: number): NativeImage {
  // macOS: a monochrome template image in the menu bar, whatever the look
  if (process.platform !== 'darwin') return sizedIcon(appIconFile(), size) ?? nativeImage.createEmpty();
  const name = 'trayTemplate.png';
  const icon = sizedIcon(assetPath(name), size) ?? nativeImage.createEmpty();
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}

export function iconDataUrl(file: string): string | undefined {
  const image = load(file);
  if (!image) return undefined;
  return image.resize({ width: 64, height: 64, quality: 'best' }).toDataURL();
}
