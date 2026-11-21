import type { ComponentChildren, Ref } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import { api } from '../store';

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label?: ComponentChildren; hint?: ComponentChildren; disabled?: boolean; testId?: string }) {
  return (
    <label class="switch" style={props.disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined} data-testid={props.testId}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span class="track" />
      {(props.label || props.hint) && (
        <span class="text">
          {props.label}
          {props.hint && <small>{props.hint}</small>}
        </span>
      )}
    </label>
  );
}

export function Field(props: { label: ComponentChildren; hint?: ComponentChildren; children: ComponentChildren; style?: Record<string, string | number> }) {
  return (
    <div class="field" style={props.style}>
      <label>{props.label}</label>
      {props.children}
      {props.hint && <span class="hint">{props.hint}</span>}
    </div>
  );
}

export function Card(props: { title: ComponentChildren; desc?: ComponentChildren; icon?: ComponentChildren; actions?: ComponentChildren; children?: ComponentChildren; testId?: string }) {
  return (
    <section class={`card${props.children ? '' : ' collapsed'}`} data-testid={props.testId}>
      <div class="card-head">
        <h3>
          {props.icon}
          {props.title}
        </h3>
        {props.desc && <span class="desc">{props.desc}</span>}
        <span class="spacer" />
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}

export function Dialog(props: { title: ComponentChildren; icon?: ComponentChildren; children: ComponentChildren; footer: ComponentChildren; onClose: () => void; testId?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="dialog" role="dialog" aria-modal="true" data-testid={props.testId}>
        <div class="dialog-head">
          {props.icon}
          <span style={{ flex: 1 }}>{props.title}</span>
          <button class="btn ghost sm icon" onClick={props.onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div class="dialog-body">{props.children}</div>
        <div class="dialog-foot">{props.footer}</div>
      </div>
    </div>
  );
}

const iconCache = new Map<string, Promise<string | undefined>>();
export function clearIconCache() {
  iconCache.clear();
}

/** Shows an icon file (path relative to the config folder) through the main process. */
export function EntryIcon(props: { path?: string; size?: number; fallback?: ComponentChildren }) {
  const [src, setSrc] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    if (!props.path) return;
    if (!iconCache.has(props.path)) iconCache.set(props.path, api.iconData(props.path));
    void iconCache.get(props.path)!.then((s) => alive && setSrc(s));
    return () => {
      alive = false;
    };
  }, [props.path]);
  if (!src) return <>{props.fallback ?? null}</>;
  return <img src={src} width={props.size ?? 20} height={props.size ?? 20} alt="" />;
}

export function TextArea(props: { value: string; onInput: (v: string) => void; rows?: number; placeholder?: string; invalid?: boolean; code?: boolean; testId?: string; autoFocus?: boolean; inputRef?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={props.inputRef}
      class={`textarea${props.invalid ? ' invalid' : ''}${props.code ? ' code' : ''}`}
      rows={props.rows ?? Math.min(12, Math.max(2, props.value.split('\n').length + 1))}
      value={props.value}
      placeholder={props.placeholder}
      spellcheck={false}
      data-testid={props.testId}
      autoFocus={props.autoFocus}
      onInput={(e) => props.onInput((e.currentTarget as HTMLTextAreaElement).value)}
      onKeyDown={(e) => {
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          const t = e.currentTarget as HTMLTextAreaElement;
          const { selectionStart: s, selectionEnd: end, value } = t;
          t.value = `${value.slice(0, s)}  ${value.slice(end)}`;
          t.selectionStart = t.selectionEnd = s + 2;
          props.onInput(t.value);
        }
      }}
    />
  );
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function timeAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleString();
}
