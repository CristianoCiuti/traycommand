import { useEffect, useRef, useState } from 'preact/hooks';
import { Keyboard, X } from 'lucide-preact';
import { canonicalHotkey, hotkeyError, hotkeyFromEvent } from '../../shared/hotkey';
import { api, hotkeyStatus, info } from '../store';
import { Keys } from './keys';

/**
 * Records a global shortcut: focus it and press the keys. While recording, the shortcuts
 * already registered are paused, so pressing one records it instead of running it.
 */
export function HotkeyInput(props: { value?: string; onChange: (v: string | undefined) => void; placeholder?: string; testId?: string; statusPath?: string }) {
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const box = useRef<HTMLDivElement>(null);
  const platform = info.value?.platform ?? 'win32';

  useEffect(() => () => api.recordingHotkey(false), []);

  const stop = () => {
    setRecording(false);
    setLive(undefined);
    api.recordingHotkey(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!recording) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        start();
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && props.value) {
        e.preventDefault();
        props.onChange(undefined);
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      stop();
      return;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      props.onChange(undefined);
      setProblem(undefined);
      stop();
      return;
    }
    const combo = hotkeyFromEvent(e, platform);
    if (!combo) {
      // only modifiers so far: show them while the user is pressing
      const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && (platform === 'darwin' ? '⌘' : 'Win')].filter(Boolean) as string[];
      setLive(mods.join(' + '));
      return;
    }
    const error = hotkeyError(combo);
    if (error) {
      setProblem(error);
      setLive(combo.replace(/\+/g, ' + '));
      return;
    }
    setProblem(undefined);
    props.onChange(canonicalHotkey(combo));
    stop();
    box.current?.focus();
  };

  const start = () => {
    setProblem(undefined);
    setRecording(true);
    api.recordingHotkey(true);
  };

  const status = props.statusPath ? hotkeyStatus.value.find((s) => s.path === props.statusPath && canonicalHotkey(s.hotkey) === canonicalHotkey(props.value ?? '')) : undefined;
  const invalid = props.value ? hotkeyError(props.value) : undefined;

  return (
    <div class="hotkey-field">
      <div
        ref={box}
        class={`hotkey-input${recording ? ' recording' : ''}${invalid || problem ? ' invalid' : ''}`}
        tabIndex={0}
        role="button"
        aria-label={props.value ? `Shortcut ${props.value}. Press Enter to change, Delete to remove` : 'Set a shortcut'}
        onClick={() => (recording ? undefined : start())}
        onKeyDown={onKeyDown}
        onKeyUp={() => recording && !problem && setLive(undefined)}
        onBlur={() => recording && stop()}
        data-testid={props.testId}
      >
        <Keyboard size={14} class="hotkey-icon" />
        {recording ? (
          <span class="hotkey-live">{live || 'Press the keys…'}</span>
        ) : props.value ? (
          <Keys hotkey={props.value} platform={platform} />
        ) : (
          <span class="hotkey-placeholder">{props.placeholder ?? 'Click and press keys'}</span>
        )}
        <span style={{ flex: 1 }} />
        {recording ? (
          <span class="hint">Esc to stop</span>
        ) : (
          props.value && (
            <button
              class="hotkey-clear"
              onClick={(e) => {
                e.stopPropagation();
                props.onChange(undefined);
              }}
              aria-label="Remove shortcut"
              title="Remove shortcut"
            >
              <X size={13} />
            </button>
          )
        )}
      </div>
      {(problem || invalid) && <span class="hint" style={{ color: 'var(--danger)' }}>{problem ?? invalid}</span>}
      {!problem && !invalid && status && !status.ok && <span class="hint" style={{ color: 'var(--warn)' }}>Not working: {status.error}</span>}
    </div>
  );
}
