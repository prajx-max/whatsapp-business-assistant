import { useState } from 'react';
import type { ShellRequest, ShellState } from '../messaging/contracts.js';
import { Card } from '../ui/shared.js';
import { BACKEND_ORIGIN } from '../background/backend-client.js';

const connectionErrors: Record<string, string> = {
  UNAUTHORIZED:
    'The backend no longer accepts this extension’s pairing code. Open AI setup for this business, save its model connection, then copy its pairing code into Business settings → AI connection and connect again.',
  NOT_CONFIGURED:
    'This business has no model key configured in the backend. Open AI setup for this business and save its model connection.',
  KEY_REJECTED:
    'Your AI provider rejected its API key. Update the model key in AI setup. Your extension pairing code can stay the same.',
  MODEL_REJECTED:
    'Your AI provider rejected the model or request. Check the model ID and API compatibility in AI setup.',
};

const deliveryReasons: Record<string, string> = {
  HUMAN_REVIEW_REQUIRED: 'This reply needs human review',
  INACTIVE_OR_CHANGED_CHAT:
    'Keep the intended WhatsApp chat active and check its settings and working hours',
  DELIVERY_STORAGE_ERROR: 'Delivery history could not be saved',
  DELIVERY_CAPACITY: 'Local delivery history has reached its limit',
  ALREADY_ATTEMPTED: 'A reply was already attempted for this message',
  COOLDOWN: 'This chat is in its reply cooldown',
  CONTEXT_CHANGED: 'The chat or latest message changed',
  COMPOSER_BUSY: 'The composer already contains text or was edited',
  SEND_UNAVAILABLE: 'The native Send button could not be used',
  AUTHORIZATION_REVOKED:
    'Automatic sending was disabled or its approval expired',
};

function LiveDraft({
  state,
  busy,
  act,
}: {
  state: ShellState;
  busy: boolean;
  act: (request: ShellRequest) => Promise<boolean>;
}) {
  const suggestion = state.live?.suggestion;
  const [text, setText] = useState(suggestion?.reply ?? '');
  const [inserted, setInserted] = useState(false);
  if (!suggestion || suggestion.state !== 'READY') return null;
  const delivery = suggestion.delivery;
  const deliveryBusy =
    delivery?.state === 'SENDING' ||
    delivery?.state === 'SENT' ||
    delivery?.state === 'UNCERTAIN';
  return (
    <Card
      title={
        suggestion.standardFallback
          ? 'Standard fallback reply'
          : suggestion.needsHuman
            ? 'Human-help draft'
            : 'AI suggested reply'
      }
    >
      <p className="small muted">
        {suggestion.provider} · {suggestion.model}
      </p>
      <label className="field">
        Live suggested reply
        <textarea
          rows={6}
          maxLength={4000}
          value={text}
          disabled={deliveryBusy}
          onChange={(event) => {
            setText(event.target.value);
            setInserted(false);
          }}
        />
      </label>
      <button
        className="button primary wide"
        disabled={busy || inserted || deliveryBusy || !text.trim()}
        onClick={(event) => {
          if (!event.nativeEvent.isTrusted) return;
          void act({
            version: 1,
            type: 'INSERT_LIVE_DRAFT',
            suggestionId: suggestion.id,
            text,
            approval: 'EXPLICIT_USER_CLICK',
          }).then((ok) => {
            if (ok) setInserted(true);
          });
        }}
      >
        {delivery?.state === 'SENT'
          ? 'Sent to WhatsApp'
          : delivery?.state === 'SENDING'
            ? 'Sending reply…'
            : delivery?.state === 'UNCERTAIN'
              ? 'Check WhatsApp before replying'
              : inserted
                ? 'Draft inserted'
                : 'Insert into WhatsApp'}
      </button>
      <p className="small muted">
        {delivery?.state === 'SENT'
          ? 'WhatsApp accepted the reply and cleared the composer. Network delivery is unverified.'
          : delivery?.state === 'SENDING'
            ? 'Checking the chat and sending the reply.'
            : delivery?.state === 'UNCERTAIN'
              ? 'Sending could not be confirmed. Check the conversation; the assistant will not retry automatically.'
              : delivery?.state === 'BLOCKED'
                ? `${deliveryReasons[delivery.reason] ?? 'Automatic sending stopped'}. Review the draft and composer before sending manually.`
                : 'Review the composer, then press WhatsApp’s own Send button.'}
      </p>
      {suggestion.needsHuman && (
        <p className="small muted">
          {suggestion.standardFallback
            ? 'Confirmed information was missing. The standard reply asks the customer to contact your team; it does not claim anyone was notified.'
            : 'Confirmed information was missing or the output needed a safer fallback.'}
        </p>
      )}
    </Card>
  );
}
export function LiveWorkspace({
  state,
  busy,
  act,
}: {
  state: ShellState;
  busy: boolean;
  act: (request: ShellRequest) => Promise<boolean>;
}) {
  const live = state.live;
  const autoReply =
    state.settings.profiles.find(
      (profile) => profile.id === state.settings.activeProfileId,
    )?.replyMode === 'AUTO_REPLY_WEB';
  const context = live?.status.context;
  const paused =
    context &&
    state.settings.takeovers[context.chatKey]?.profileId === context.profileId;
  const [connectionNotice, setConnectionNotice] = useState('');
  const suggestionError = live?.suggestion?.error ?? '';
  const connectionError = connectionErrors[suggestionError];
  return (
    <section className="live-workspace">
      <div className="section-label">
        <span>WHATSAPP WORKSPACE</span>
        <span
          className={`pill ${live?.status.ready ? 'pill-green' : 'pill-muted'}`}
        >
          {live?.status.ready ? 'Chat ready' : 'Waiting'}
        </span>
      </div>
      {!live?.status.ready && (
        <div>
          <button
            className="button secondary wide"
            disabled={busy}
            onClick={(event) => {
              if (!event.nativeEvent.isTrusted) return;
              setConnectionNotice('Reconnecting the open WhatsApp tab…');
              void act({ type: 'RECONNECT_WHATSAPP', version: 1 }).then((ok) =>
                setConnectionNotice(
                  ok
                    ? 'Adapter reconnected. Existing messages were ignored; wait for Chat ready.'
                    : 'Open WhatsApp Web and allow site access in Chrome, then reconnect.',
                ),
              );
            }}
          >
            Reconnect WhatsApp
          </button>
          <p className="small muted" role="status">
            {connectionNotice}
          </p>
        </div>
      )}
      {!live?.status.context ? (
        <div className="sample-banner">
          <div>
            <strong>Open WhatsApp Web and select a chat</strong>
            <p>
              Only new incoming text is observed. Add business information and
              connect your AI backend in settings to generate suggestions.
            </p>
            <p>
              {live
                ? 'The adapter is connected but cannot identify the open chat yet. Check WhatsApp adapter diagnostics in Business settings.'
                : 'Reload your WhatsApp Web tab after installing or reloading the extension, then select a chat. Check that Chrome allows this extension on web.whatsapp.com.'}
            </p>
          </div>
        </div>
      ) : (
        <Card title={live.status.context.chatLabel || 'Active chat'}>
          <p className="small muted">
            {live.status.ready
              ? 'Adapter ready · Existing messages ignored'
              : 'Checking the chat and composer…'}
          </p>
          {autoReply && (
            <div>
              <p className="small muted" role="status">
                {paused
                  ? 'Auto-reply paused for this chat'
                  : state.settings.enabled
                    ? 'Auto-reply active · Keep WhatsApp in the active tab'
                    : 'Assistant is disabled'}
              </p>
              <button
                className="button secondary wide"
                disabled={busy}
                onClick={(event) => {
                  if (event.nativeEvent.isTrusted && context)
                    void act({
                      type: 'SET_CHAT_TAKEOVER',
                      version: 1,
                      context,
                      paused: !paused,
                    });
                }}
              >
                {paused
                  ? 'Resume auto-reply for this chat'
                  : 'Pause auto-reply for this chat'}
              </button>
            </div>
          )}
          <div className="message-bubble">
            {live.message?.text ?? 'Waiting for a new incoming message.'}
          </div>
          {live.message && (
            <button
              className="button secondary wide"
              disabled={
                busy ||
                live.suggestion?.state === 'GENERATING' ||
                live.suggestion?.state === 'WAITING' ||
                (live.suggestion?.delivery !== undefined &&
                  live.suggestion.delivery.state !== 'BLOCKED') ||
                !state.settings.enabled
              }
              onClick={(event) => {
                if (event.nativeEvent.isTrusted)
                  void act({ type: 'RETRY_SUGGESTION', version: 1 });
              }}
            >
              {live.suggestion?.state === 'WAITING'
                ? 'Waiting to reply…'
                : live.suggestion?.state === 'GENERATING'
                  ? 'Generating suggestion…'
                  : autoReply
                    ? 'Generate manual draft'
                    : 'Generate suggestion'}
            </button>
          )}
          {autoReply && !paused && (
            <p className="small muted">
              New incoming messages generate and send replies automatically.
              Manual draft tools are optional.
            </p>
          )}
          {live.suggestion?.state === 'WAITING' && (
            <p className="small muted" role="status">
              Waiting briefly before replying to your latest message. Keep this
              chat active; no button press is needed.
            </p>
          )}
          {live.suggestion?.state === 'ERROR' && (
            <div className="error-notice" role="alert">
              <p>
                {connectionError ??
                  (live.suggestion.error === 'COOLDOWN_TOO_LONG'
                    ? 'The reply interval is longer than the automatic reply window. Reduce Minimum time between replies in Reply preferences, or generate a draft.'
                    : live.suggestion.error === 'MESSAGE_EXPIRED'
                      ? 'This message waited too long for an automatic reply. Generate a draft, or wait for a new incoming message.'
                      : live.suggestion.error === 'COOLDOWN'
                        ? 'This chat is waiting between replies. Generate a draft now, or update the extension to resume automatically.'
                        : `Suggestion unavailable: ${live.suggestion.error}. Check AI settings, or retry this message.`)}
              </p>
              {connectionError && (
                <>
                  <button
                    className="button secondary wide"
                    type="button"
                    onClick={() => {
                      const url = `${BACKEND_ORIGIN}/setup?profileId=${encodeURIComponent(state.settings.activeProfileId)}`;
                      void chrome.tabs
                        .create({ url })
                        .catch(() =>
                          setConnectionNotice(`Open ${url} in your browser.`),
                        );
                    }}
                  >
                    Open AI setup for this business ↗
                  </button>
                  <p className="small" role="status">
                    {connectionNotice}
                  </p>
                </>
              )}
            </div>
          )}
        </Card>
      )}
      {live?.suggestion?.state === 'READY' && (
        <LiveDraft
          key={live.suggestion.id}
          state={state}
          busy={busy}
          act={act}
        />
      )}
    </section>
  );
}
