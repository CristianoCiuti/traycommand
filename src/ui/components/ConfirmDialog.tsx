import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { CircleHelp, TriangleAlert } from 'lucide-preact';
import { Dialog } from './ui';

export interface ConfirmOptions {
  title: string;
  text: string;
  /** Text of the button that goes ahead. */
  button: string;
  /** Cancel button text. Default: "Cancel". */
  cancel?: string;
  /** A destructive choice: the button is red. */
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const pending = signal<Pending | undefined>(undefined);

/**
 * Asks a question in a dialog of the editor (instead of the system window of confirm()).
 * Enter goes ahead; Esc, Cancel, the close button or a click outside cancel. Resolves true to go ahead.
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  pending.peek()?.resolve(false); // one question at a time: an older one is cancelled
  return new Promise((resolve) => {
    pending.value = { ...options, resolve };
  });
}

function answer(ok: boolean) {
  const p = pending.peek();
  if (!p) return;
  pending.value = undefined;
  p.resolve(ok);
}

/** Shows the question asked with askConfirm (rendered once, at the root of the editor). */
export function ConfirmHost() {
  const p = pending.value;
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!p) return;
    ok.current?.focus(); // away from the button that asked, behind the dialog
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      // a button of the dialog answers with its own click (Tab to Cancel, then Enter, cancels)
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'BUTTON' && target.closest('[role="dialog"]')) return;
      e.preventDefault();
      answer(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);
  if (!p) return null;
  return (
    <Dialog
      title={p.title}
      icon={p.danger ? <TriangleAlert size={16} /> : <CircleHelp size={16} />}
      onClose={() => answer(false)}
      testId="confirm-dialog"
      footer={
        <>
          <button class="btn ghost" onClick={() => answer(false)} data-testid="confirm-cancel">
            {p.cancel ?? 'Cancel'}
          </button>
          <button
            class={`btn ${p.danger ? 'danger' : 'primary'}`}
            ref={ok}
            onClick={() => answer(true)}
            data-testid="confirm-ok"
          >
            {p.button}
          </button>
        </>
      }
    >
      <div style={{ whiteSpace: 'pre-line' }} data-testid="confirm-text">
        {p.text}
      </div>
    </Dialog>
  );
}
