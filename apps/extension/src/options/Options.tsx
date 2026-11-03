import { useEffect, useState } from 'react';
import { BusinessProfileSchema, LanguageSchema } from '@assistant/contracts';
import type { BusinessProfile } from '@assistant/contracts';
import type { AssistantClient } from '../messaging/client.js';
import type { ProfileEdit } from '../messaging/contracts.js';
import { ProfileEditSchema } from '../messaging/contracts.js';
import { useAssistant } from '../ui/use-assistant.js';
import { AiConnection } from './AiConnection.js';
import { AdapterDiagnostics } from './AdapterDiagnostics.js';
import {
  Brand,
  Card,
  EnabledSwitch,
  ErrorNotice,
  Loading,
  StatusPill,
} from '../ui/shared.js';

interface ProfileFormProps {
  profile: BusinessProfile;
  revision: number;
  busy: boolean;
  save: (edit: ProfileEdit) => Promise<boolean>;
}
const fieldsFrom = (
  profile: BusinessProfile,
  revision: number,
): ProfileEdit => ({
  profileId: profile.id,
  expectedRevision: revision,
  name: profile.name,
  tone: profile.tone,
  defaultLanguage: profile.defaultLanguage,
  timezone: profile.timezone,
  workingHours: profile.workingHours.description,
  replyMode:
    profile.replyMode === 'AUTO_SAFE_OFFICIAL_TRANSPORT'
      ? 'DRAFT_ONLY'
      : profile.replyMode,
  webAutoSendOptIn: profile.webAutoSendOptIn,
  perChatCooldownSeconds: profile.behavior.perChatCooldownSeconds,
  replyInstructions: profile.replyInstructions,
  businessInformation: profile.businessInformation,
});
function ProfileForm({ profile, revision, busy, save }: ProfileFormProps) {
  const [fields, setFields] = useState(() => fieldsFrom(profile, revision));
  const [dirty, setDirty] = useState(false);
  const [validation, setValidation] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!dirty) setFields(fieldsFrom(profile, revision));
  }, [profile, revision, dirty]);
  function update(change: Partial<ProfileEdit>) {
    setFields((current) => ({ ...current, ...change }));
    setDirty(true);
    setSaved(false);
  }
  async function submit() {
    const parsed = ProfileEditSchema.safeParse(fields);
    if (!parsed.success) {
      setValidation(
        parsed.error.issues.map((issue) => issue.message).join('. '),
      );
      return;
    }
    setValidation('');
    if (await save(parsed.data)) {
      setDirty(false);
      setSaved(true);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <section id="business" className="card form-card">
        <div className="card-heading">
          <div>
            <h2>Business profile</h2>
            <p className="muted">Give your assistant a little context.</p>
          </div>
          <span className="pill pill-muted">Sample profile</span>
        </div>
        <label className="field">
          Business name
          <input
            required
            maxLength={200}
            value={fields.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <div className="field-grid">
          <label className="field">
            Industry
            <input value={profile.industry} readOnly />
          </label>
          <label className="field">
            Timezone
            <input
              required
              maxLength={100}
              value={fields.timezone}
              placeholder="Asia/Kolkata"
              onChange={(event) => update({ timezone: event.target.value })}
            />
          </label>
        </div>
        <label className="field">
          Business hours
          <input
            required
            maxLength={500}
            value={fields.workingHours}
            onChange={(event) => update({ workingHours: event.target.value })}
          />
          <span className="field-hint">
            Describe your hours here. This text field does not restrict when
            replies are sent.
          </span>
        </label>
      </section>
      <section id="preferences" className="card form-card">
        <h2>Reply preferences</h2>
        <p className="muted">Set the voice you want to build on.</p>
        <div className="field-grid">
          <label className="field">
            Tone
            <select
              value={fields.tone}
              onChange={(event) =>
                update({
                  tone: BusinessProfileSchema.shape.tone.parse(
                    event.target.value,
                  ),
                })
              }
            >
              <option value="friendly">Friendly</option>
              <option value="professional">Professional</option>
              <option value="formal">Formal</option>
              <option value="casual">Casual</option>
            </select>
          </label>
          <label className="field">
            Default language
            <select
              value={fields.defaultLanguage}
              onChange={(event) =>
                update({
                  defaultLanguage: LanguageSchema.parse(event.target.value),
                })
              }
            >
              <option value="en">English</option>
              <option value="kn">Kannada · ಕನ್ನಡ</option>
              <option value="te">Telugu · తెలుగు</option>
              <option value="ta">Tamil · தமிழ்</option>
              <option value="hi">Hindi · हिन्दी</option>
            </select>
          </label>
        </div>
        <p className="small muted">
          These preferences apply to live AI suggestions. The optional fixed
          sample remains in English.
        </p>
        <fieldset className="mode-fieldset">
          <legend>Reply mode</legend>
          <label
            className={`mode-option ${fields.replyMode === 'DRAFT_ONLY' ? 'selected' : ''}`}
          >
            <input
              type="radio"
              name="replyMode"
              value="DRAFT_ONLY"
              checked={fields.replyMode === 'DRAFT_ONLY'}
              onChange={() =>
                update({ replyMode: 'DRAFT_ONLY', webAutoSendOptIn: false })
              }
            />
            <span>
              <strong>Draft only</strong>
              <span className="small muted">
                Review every suggestion before you send.
              </span>
            </span>
            <span className="pill pill-green">Recommended</span>
          </label>
          <label
            className={`mode-option ${fields.replyMode === 'AUTO_REPLY_WEB' ? 'selected' : ''}`}
          >
            <input
              type="radio"
              name="replyMode"
              value="AUTO_REPLY_WEB"
              checked={fields.replyMode === 'AUTO_REPLY_WEB'}
              onChange={() => update({ replyMode: 'AUTO_REPLY_WEB' })}
            />
            <span>
              <strong>Auto-reply</strong>
              <span className="small muted">
                Generate and send eligible replies in the active WhatsApp chat.
              </span>
            </span>
          </label>
          {fields.replyMode === 'AUTO_REPLY_WEB' && (
            <label className="consent-option">
              <input
                type="checkbox"
                checked={fields.webAutoSendOptIn}
                onChange={(event) =>
                  update({ webAutoSendOptIn: event.target.checked })
                }
              />
              <span>
                Allow automatic sending without review
                <span className="small muted">
                  New incoming text and business information go to your selected
                  AI provider. Keep WhatsApp open in the active tab. Missing
                  facts receive a standard fallback reply. Pause any chat from
                  the workspace.
                </span>
              </span>
            </label>
          )}
          <label
            className={`mode-option ${fields.replyMode === 'OFF' ? 'selected' : ''}`}
          >
            <input
              type="radio"
              name="replyMode"
              value="OFF"
              checked={fields.replyMode === 'OFF'}
              onChange={() =>
                update({ replyMode: 'OFF', webAutoSendOptIn: false })
              }
            />
            <span>
              <strong>Off</strong>
              <span className="small muted">
                Pause assistant replies for this business.
              </span>
            </span>
          </label>
        </fieldset>
        <label className="field">
          Minimum time between replies (seconds)
          <input
            type="number"
            min={0}
            max={86400}
            step={1}
            required
            value={
              Number.isNaN(fields.perChatCooldownSeconds)
                ? ''
                : (fields.perChatCooldownSeconds ??
                  profile.behavior.perChatCooldownSeconds)
            }
            onChange={(event) =>
              update({ perChatCooldownSeconds: event.target.valueAsNumber })
            }
          />
          <span className="field-hint">
            New messages received close together wait automatically. Only the
            latest message is answered. Use 0 for no cooldown.
          </span>
        </label>
        <label className="field">
          Reply instructions
          <textarea
            rows={6}
            maxLength={8000}
            value={fields.replyInstructions}
            placeholder="For example: Reply politely, use the customer’s language, keep replies brief, and ask our team when unsure."
            onChange={(event) =>
              update({ replyInstructions: event.target.value })
            }
          />
          <span className="field-hint">
            Rules for tone, language and escalation. Do not paste API keys here.
          </span>
        </label>
        <label className="field">
          Business information
          <textarea
            rows={7}
            maxLength={16000}
            value={fields.businessInformation}
            placeholder="Add confirmed products, exact prices, hours, availability, document requirements and policies."
            onChange={(event) =>
              update({ businessInformation: event.target.value })
            }
          />
          <span className="field-hint">
            The AI uses these facts. Missing facts produce a human-help draft
            rather than a guess.
          </span>
        </label>
      </section>
      <ErrorNotice message={validation} />
      {dirty && revision !== fields.expectedRevision && (
        <div className="error-notice" role="alert">
          Settings changed elsewhere. Your edits are kept here. Reload this page
          to review the latest version before saving.
          <button
            type="button"
            className="text-button"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      )}
      <div className="save-bar">
        <span className="small muted" role="status">
          {saved
            ? 'Settings saved'
            : dirty
              ? 'You have unsaved changes'
              : 'All changes saved'}
        </span>
        <button
          type="submit"
          className="button primary"
          disabled={busy || !dirty || revision !== fields.expectedRevision}
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

export function Options({ client }: { client?: AssistantClient }) {
  const { state, error, busy, act } = useAssistant(client);
  if (!state) return <Loading error={error} />;
  const profile = state.settings.profiles.find(
    (item) => item.id === state.settings.activeProfileId,
  );
  if (!profile) return <Loading error="The active profile is missing." />;
  return (
    <div className="options-page">
      <header className="options-topbar">
        <Brand />
        <span className="pill pill-muted">WhatsApp + AI suggestions</span>
      </header>
      <div className="options-layout">
        <aside className="settings-sidebar">
          <span className="eyebrow">YOUR WORKSPACE</span>
          <div className="business-tile">
            <span className="avatar">SC</span>
            <div>
              <strong>{profile.name}</strong>
              <span className="small muted">Sample business</span>
            </div>
          </div>
          <nav aria-label="Settings sections">
            <a href="#business" className="nav-active">
              Business profile <span aria-hidden="true">↗</span>
            </a>
            <a href="#preferences">Reply preferences</a>
            <a href="#privacy">Privacy & storage</a>
            <a href="#connections">Connections</a>
          </nav>
          <div className="sidebar-note">
            <span aria-hidden="true">◇</span>
            <p>
              Good support starts with trust.
              <br />
              Choose how your assistant replies.
            </p>
          </div>
        </aside>
        <main className="settings-main">
          <div className="settings-heading">
            <div>
              <span className="eyebrow">MAKE IT YOURS</span>
              <h1>
                Your business.
                <br />
                Your way of helping.
              </h1>
              <p className="muted">
                A few thoughtful defaults for better conversations.
              </p>
            </div>
            <StatusPill enabled={state.settings.enabled} />
          </div>
          <div className="control-row card">
            <div>
              <strong>Assistant enabled</strong>
              <p className="small muted">
                Switch off to pause replies for this business.
              </p>
            </div>
            <EnabledSwitch
              enabled={state.settings.enabled}
              disabled={busy}
              onChange={(enabled) =>
                act({ version: 1, type: 'SET_ENABLED', enabled })
              }
            />
          </div>
          <ErrorNotice message={error} />
          <ProfileForm
            key={profile.id}
            profile={profile}
            revision={state.settings.revision}
            busy={busy}
            save={(edit) => act({ version: 1, type: 'SAVE_PROFILE', edit })}
          />
          <AiConnection
            key={`connection-${profile.id}`}
            state={state}
            busy={busy}
            act={act}
          />
          <AdapterDiagnostics state={state} busy={busy} act={act} />
          <section id="privacy">
            <Card title="Privacy & storage">
              <div className="status-list">
                <div>
                  <span>Raw message history</span>
                  <strong>Not stored</strong>
                </div>
                <div>
                  <span>Phone masking</span>
                  <strong>Always on</strong>
                </div>
                <div>
                  <span>Configured log retention</span>
                  <strong>{profile.privacy.logRetentionDays} days</strong>
                </div>
                <div>
                  <span>Settings location</span>
                  <strong>This browser</strong>
                </div>
              </div>
              <p className="small muted">
                Settings and hashed duplicate identifiers are saved locally.
                Live messages and replies stay only in worker memory. New
                incoming text is sent to your selected provider only after you
                connect a backend and enable AI suggestions or Auto-reply, or
                explicitly generate a reply. Provider data policies still apply.
              </p>
            </Card>
          </section>
          <section id="connections">
            <Card title="Connections">
              <div className="connection-row">
                <span className="connection-icon" aria-hidden="true">
                  ▤
                </span>
                <div>
                  <strong>Sample bakery knowledge</strong>
                  <p className="small muted">
                    Static demonstration · No live sync
                  </p>
                </div>
                <span className="pill pill-muted">Sample</span>
              </div>
              <div className="connection-row">
                <span className="connection-icon" aria-hidden="true">
                  ↗
                </span>
                <div>
                  <strong>WhatsApp Web</strong>
                  <p className="small muted">
                    New messages in the open chat only
                  </p>
                </div>
                <span className="pill pill-muted">
                  {state.adapterStatus === 'READY' ? 'Ready' : 'Waiting'}
                </span>
              </div>
              <p className="small muted">
                Google Sheets setup arrives in Milestone 4. Multiple business
                profiles arrive in Milestone 7.
              </p>
            </Card>
          </section>
          <footer className="settings-footer">
            Universal Business Assistant · Built around your business.
          </footer>
        </main>
      </div>
    </div>
  );
}
