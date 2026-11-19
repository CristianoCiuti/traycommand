import { ImagePlus, X } from 'lucide-preact';
import { api } from '../store';
import { EntryIcon } from '../components/ui';

const FILTERS = [{ name: 'Images', extensions: ['png', 'ico', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }];

async function pick(current?: string): Promise<string | undefined> {
  const file = await api.pickFile({ title: 'Choose an icon', filters: FILTERS, defaultPath: current });
  return file ? api.relativeToConfig(file) : undefined;
}

export function IconPicker(props: { value?: string; onChange: (v: string | undefined) => void; compact?: boolean; large?: boolean }) {
  if (props.large) {
    return (
      <button class="icon-pick" title={props.value ?? 'Choose an icon'} onClick={async () => {
          const v = await pick(props.value);
          if (v) props.onChange(v);
        }} data-testid="icon-pick">
        <EntryIcon path={props.value} size={36} fallback={<ImagePlus size={22} />} />
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button class="btn sm" style={{ flex: 1, justifyContent: 'flex-start', overflow: 'hidden' }} onClick={async () => {
        const v = await pick(props.value);
        if (v) props.onChange(v);
      }}>
        <EntryIcon path={props.value} size={16} fallback={<ImagePlus size={14} />} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{props.value ?? 'Choose…'}</span>
      </button>
      {props.value && (
        <button class="btn sm icon ghost" onClick={() => props.onChange(undefined)} aria-label="Remove icon">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
