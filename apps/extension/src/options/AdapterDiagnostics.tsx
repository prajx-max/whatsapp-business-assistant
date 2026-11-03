import { useState } from 'react';
import { SelectorPackSchema } from '@assistant/contracts';
import type { ShellRequest, ShellState } from '../messaging/contracts.js';

export function AdapterDiagnostics({
  state,
  busy,
  act,
}: {
  state: ShellState;
  busy: boolean;
  act: (request: ShellRequest) => Promise<boolean>;
}) {
  const [text, setText] = useState(() =>
    JSON.stringify(state.settings.selectors, null, 2),
  );
  const [notice, setNotice] = useState('');
  const report = JSON.stringify(
    {
      installedVersion:
        typeof chrome !== 'undefined' && chrome.runtime?.getManifest
          ? chrome.runtime.getManifest().version
          : 'unknown',
      savedSelectorVersion: state.settings.selectors.version,
      adapterReported: Boolean(state.live),
      matches: state.live?.status.matches ?? null,
      structure: state.live?.status.structure ?? null,
    },
    null,
    2,
  );
  async function save() {
    try {
      const selectors = SelectorPackSchema.parse(JSON.parse(text) as unknown);
      if (await act({ type: 'SAVE_SELECTORS', version: 1, selectors }))
        setNotice(
          'Selector pack saved. Open chats were rebaselined; old messages were ignored.',
        );
    } catch {
      setNotice(
        'Invalid selector JSON. Keep all eight selector groups, one to eight CSS candidates per group, and a positive version.',
      );
    }
  }
  return (
    <section className="card" id="diagnostics">
      <h2>WhatsApp adapter diagnostics</h2>
      <p className="small muted">
        Saved selectors: v{state.settings.selectors.version} · Running adapter:{' '}
        {state.live?.status.structure?.buildVersion ?? 'version unavailable'}
      </p>
      <p className="small muted">
        Status:{' '}
        {state.adapterStatus === 'READY'
          ? 'Ready'
          : 'Waiting for WhatsApp and an open chat'}
        . Selectors may need adjustment when WhatsApp changes its layout.
      </p>
      {!state.live && (
        <p className="error-notice" role="status">
          No WhatsApp tab has reported yet. Reload WhatsApp Web after installing
          or reloading this extension, then select a chat. Check Chrome’s
          extension site access allows web.whatsapp.com.
        </p>
      )}
      {state.live && !state.live.status.ready && (
        <p className="small muted" role="status">
          The adapter is connected. Open a chat and check the missing
          chatHeader, messageList or composer entries below.
          Incoming/outgoing/text entries can be absent in an empty chat.
        </p>
      )}
      {state.live && (
        <div className="status-list">
          {Object.entries(state.live.status.matches).map(([name, index]) => (
            <div key={name}>
              <span>{name}</span>
              <strong>
                {index >= 0 ? `Fallback ${index + 1} matched` : 'Not found'}
              </strong>
            </div>
          ))}
        </div>
      )}
      <details>
        <summary>Copy structural diagnostic report</summary>
        <p className="small muted">
          Versions, counts and sanitized wrapper metadata only. No chat text,
          phone numbers, message IDs, keys or pairing codes are included.
        </p>
        <label className="field">
          Structural diagnostic report
          <textarea readOnly rows={12} value={report} />
        </label>
        <button
          className="button secondary"
          onClick={() => {
            void navigator.clipboard.writeText(report).then(
              () =>
                setNotice(
                  'Structural report copied. Paste it into the support chat.',
                ),
              () =>
                setNotice(
                  'Select the structural report above and copy it manually.',
                ),
            );
          }}
        >
          Copy diagnostic report
        </button>
        <p className="small muted" role="status">
          {notice}
        </p>
      </details>
      <details>
        <summary>Advanced selector configuration</summary>
        <p className="small muted">
          JSON data only. Paste or copy this pack to import or export selectors.
          Invalid CSS is ignored and falls back to the next candidate.
        </p>
        <label className="field">
          Selector pack JSON
          <textarea
            rows={12}
            maxLength={24000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            void save();
          }}
        >
          Save selector pack
        </button>
        <p className="small muted" role="status">
          {notice}
        </p>
      </details>
    </section>
  );
}
