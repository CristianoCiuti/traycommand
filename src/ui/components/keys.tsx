import { hotkeyKeys } from '../../shared/hotkey';

/** A shortcut drawn as keycaps: Ctrl + Alt + Space. */
export function Keys(props: { hotkey: string; platform?: string; small?: boolean }) {
  return (
    <span class={`keys${props.small ? ' small' : ''}`}>
      {hotkeyKeys(props.hotkey, props.platform).map((k) => (
        <kbd>{k}</kbd>
      ))}
    </span>
  );
}
