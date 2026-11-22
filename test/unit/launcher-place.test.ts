import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { launcherOrigin } from '../../src/main/launcherPlace';
import { LauncherStore } from '../../src/main/launcherStore';
import { bundleIconOutdated, customIconFile } from '../../src/main/macIcon';

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 1280, height: 1000 };
const size = { width: 680, height: 300, maxHeight: 520 };

describe('launcher position', () => {
  it('is centred when never moved', () => {
    expect(launcherOrigin(undefined, size, [primary], primary)).toEqual({ x: 620, y: 260 });
  });

  it('stays where the person moved it, also on another screen', () => {
    expect(launcherOrigin({ x: 100, y: 50 }, size, [primary, second], primary)).toEqual({ x: 100, y: 50 });
    expect(launcherOrigin({ x: 2000, y: 400 }, size, [primary, second], primary)).toEqual({ x: 2000, y: 400 });
  });

  it('is pulled back inside the screen when it would stick out', () => {
    // dragged so that its right side and its bottom are off the primary screen
    expect(launcherOrigin({ x: 1500, y: 900 }, size, [primary, second], primary)).toEqual({ x: 1240, y: 740 });
  });

  it('goes back to the centre when its screen is gone', () => {
    expect(launcherOrigin({ x: 2000, y: 400 }, size, [primary], primary)).toEqual({ x: 620, y: 260 });
  });

  it('is remembered in the launcher store', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pos-'));
    const file = path.join(dir, 'launcher.json');
    const store = new LauncherStore(file);
    expect(store.position).toBeUndefined();
    store.setPosition({ x: 10.4, y: 20.6 });
    store.flush();
    expect(new LauncherStore(file).position).toEqual({ x: 10, y: 21 });
    store.setPosition(undefined);
    store.flush();
    expect(new LauncherStore(file).position).toBeUndefined();
    fs.writeFileSync(file, JSON.stringify({ position: { x: 'a', y: 1 } }));
    expect(new LauncherStore(file).position).toBeUndefined();
  });
});

describe('macOS app icon', () => {
  it('is set again for another look or when Finder lost it', () => {
    const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-app-'));
    expect(bundleIconOutdated(bundle, 'neon', undefined)).toBe(true);
    expect(bundleIconOutdated(bundle, 'neon', 'neon')).toBe(true); // no custom icon in the bundle (e.g. after an update)
    try {
      fs.writeFileSync(customIconFile(bundle), '');
    } catch {
      return; // file names with a carriage return are not allowed on Windows
    }
    expect(bundleIconOutdated(bundle, 'neon', 'neon')).toBe(false);
    expect(bundleIconOutdated(bundle, 'brutal', 'neon')).toBe(true);
  });
});
