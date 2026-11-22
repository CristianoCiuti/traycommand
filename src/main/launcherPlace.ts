export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Top-left corner of the launcher window: the position the person chose when it is still
 * mostly on a screen (pulled fully inside that screen), else centred on the primary display.
 */
export function launcherOrigin(saved: { x: number; y: number } | undefined, size: { width: number; height: number; maxHeight: number }, areas: Area[], primary: Area): { x: number; y: number } {
  if (saved) {
    const cx = saved.x + size.width / 2;
    const cy = saved.y + 40;
    const area = areas.find((a) => cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height);
    if (area) {
      const x = Math.min(Math.max(saved.x, area.x), area.x + Math.max(0, area.width - size.width));
      const y = Math.min(Math.max(saved.y, area.y), area.y + Math.max(0, area.height - size.height));
      return { x: Math.round(x), y: Math.round(y) };
    }
  }
  return {
    x: Math.round(primary.x + (primary.width - size.width) / 2),
    y: Math.round(primary.y + Math.max(16, (primary.height - size.maxHeight) / 2)),
  };
}
