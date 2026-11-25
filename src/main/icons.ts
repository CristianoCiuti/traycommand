import { nativeImage, type NativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { drawBadge } from '../shared/badge';

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

/** The image with the "busy" badge drawn over it, at each of its resolutions (1x, 2x). */
export function withBusyBadge(image: NativeImage): NativeImage {
  const result = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    // getSize is in logical pixels: the bitmap of a representation has `scale` times as many
    const size = image.getSize(scale);
    const width = Math.round(size.width * scale);
    const height = Math.round(size.height * scale);
    const bitmap = image.toBitmap({ scaleFactor: scale });
    if (!width || !height || bitmap.length !== width * height * 4) continue; // no representation at that scale
    const drawn = nativeImage.createFromBitmap(Buffer.from(drawBadge(bitmap, width, height)), { width, height });
    result.addRepresentation({ scaleFactor: scale, width, height, buffer: drawn.toPNG() });
  }
  return result.isEmpty() ? image : result;
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

/** Icon of the look in use, in colour (window, menus, and the tray unless macOS asks for the monochrome one). */
export function appIcon(size: number): NativeImage {
  return sizedIcon(appIconFile(), size) ?? nativeImage.createEmpty();
}

/** macOS: the person chose the monochrome symbol in the style of the other menu bar icons. */
let monochromeMenuBar = false;
export function setMonochromeMenuBar(on: boolean) {
  monochromeMenuBar = on;
}

/** Icon of TrayCommand in the tray / menu bar: on macOS a template image (drawn by the system in the bar's colour) when chosen. */
export function trayIcon(size: number): NativeImage {
  if (process.platform !== 'darwin' || !monochromeMenuBar) return appIcon(size);
  const icon = sizedIcon(assetPath('trayTemplate.png'), size);
  if (!icon) return appIcon(size);
  icon.setTemplateImage(true);
  return icon;
}

export function iconDataUrl(file: string): string | undefined {
  const image = load(file);
  if (!image) return undefined;
  return image.resize({ width: 64, height: 64, quality: 'best' }).toDataURL();
}
