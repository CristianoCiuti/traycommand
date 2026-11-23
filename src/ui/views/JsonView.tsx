import { useEffect, useState } from 'preact/hooks';
import { Check, ExternalLink } from 'lucide-preact';
import { api, dirty, draft, info, loadIssues, rawText, reload, showToast } from '../store';
import type { ConfigIssue } from '../../shared/config';
import { TextArea } from '../components/ui';

export function JsonView() {
  const [text, setText] = useState(rawText.value);
  const [issues, setIssues] = useState<ConfigIssue[]>(loadIssues.value);
  useEffect(() => {
    // the visual editor has unsaved changes: show them, otherwise the file content
    setText(dirty.value && draft.value ? JSON.stringify(draft.value, null, 2) : rawText.value);
    setIssues(loadIssues.value);
  }, [rawText.value]);

  const validate = async (value: string) => {
    try {
      const r = await api.validate(JSON.parse(value));
      setIssues(r.ok ? [] : (r.issues ?? []));
    } catch (e) {
      setIssues([{ path: '', message: `Invalid JSON: ${(e as Error).message}` }]);
    }
  };

  const saveRaw = async () => {
    const r = await api.saveRaw(text);
    if (!r.ok) {
      setIssues(r.issues ?? []);
      showToast('Not saved: fix the errors first', 'error');
      return;
    }
    await reload();
    draft.value = structuredClone(JSON.parse(text));
    await reload();
    showToast('Saved');
  };

  return (
    <div class="page">
      <div class="page-inner" style={{ maxWidth: 1100 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 data-hud="SYS // 05 · RAW DATA">Configuration JSON</h1>
            <p class="lead path">{info.value?.configPath}</p>
          </div>
          {info.value && (
            <button class="btn" onClick={() => api.openExternal(`${info.value!.docsUrl}reference/`)}>
              <ExternalLink size={14} /> Reference
            </button>
          )}
          <button class="btn primary" onClick={saveRaw} data-testid="json-save">
            <Check size={14} /> Save JSON
          </button>
        </div>
        {issues.length > 0 && (
          <div class="issues" data-testid="json-issues">
            <b>{issues.length} problem{issues.length > 1 ? 's' : ''}</b>
            <ul>
              {issues.slice(0, 12).map((i) => (
                <li>
                  {i.path && <code>{i.path}</code>} {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div class="json-editor">
          <TextArea
            code
            rows={30}
            value={text}
            onInput={(v) => {
              setText(v);
              void validate(v);
            }}
            testId="json-text"
          />
        </div>
      </div>
    </div>
  );
}
