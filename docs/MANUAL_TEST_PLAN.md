# Manual test plan

1. Run `pnpm check`; load production `apps/extension/dist` in Chrome Developer mode. Reload an existing installation and WhatsApp tab to apply host permissions/content code. Confirm only storage/sidePanel/scripting plus WhatsApp and loopback website access.
2. Run `pnpm dev:api`. Open http://127.0.0.1:3000/setup. Select a supported provider/model and enter a dedicated test key. Verify password masking, clearing after save, no echoed key, and a pairing code. The optional Test model connection button makes one provider request and may incur charges.
3. Open Business settings. Save verified Business information and Reply instructions. Reopen and confirm persistence. Never put API keys in those fields. Pair the correct profile; explicitly choose whether new messages can trigger generation automatically.
4. Open a dedicated WhatsApp test chat with permitted participants. Wait for Chat ready. Confirm existing text, chat switches, outgoing messages, prepended history and duplicate DOM nodes do not generate replies. Do not browse unrelated conversations for testing.
5. Have a test participant send one new question. Verify a suggestion uses the saved instructions and exact facts. Ask an unsupported question and inspect the human-handoff draft. Exercise each intended provider/model and language with real test credentials before relying on it.
6. Review/edit a draft and click Insert draft with the target WhatsApp tab active. Confirm composer text appears and no message is sent. Send manually through WhatsApp only when the participant expects the test. Changing chat, typing your own composer text, disabling the assistant or switching profile must prevent stale insertion.
7. Disconnect/revoke pairing, restart the backend and recreate the worker. Confirm old pairing fails, runtime keys must be reentered, live drafts vanish and existing chat history is baselined. Inspect diagnostics if selectors fail; edit only validated selector JSON, never imported code.
8. Turn auto suggestions off and verify generation occurs only after an explicit workspace action. Inspect extension storage: no provider key or raw live conversation should be persisted. Inspect backend responses/logs: no key, customer body or raw upstream error should appear.
9. Check actual Chrome side-panel launch from the popup, keyboard navigation, visible errors/retry, 360px options and 320px workspace. Save a dirty form, change settings elsewhere and verify stale edits are preserved with a conflict notice.

Automated checks cover synthetic equivalents, not live-account approval. Sheets/tickets/notifications/alarms/profile onboarding remain out of scope; do not interpret their schemas or fictional sample as working integrations.

## Opt-in Auto-reply 0.3.0

Use a dedicated test chat with a participant expecting automatic replies. Keep the configured backend running. Reload extension 0.3.0 and WhatsApp. In Reply preferences choose Auto-reply, check Allow automatic sending without review and save. Wait for Chat ready with WhatsApp active; have the participant send a new question. Verify one native send and a cleared composer. Check delivery inside WhatsApp; the workspace's Sent status does not verify network delivery.

Repeat with text already in the composer, a later operator reply, a changed/edited incoming source, an inactive tab, a human-help answer and a chat/settings change during generation. No automatic send should occur; do not clear your own draft for the test. Missing Send selectors leave the generated text for manual handling. An unconfirmed click must not be retried automatically or through Generate suggestion.

Pause auto-reply for the current chat, send new test text and confirm no automatic generation/send. Restart the worker; the pause must remain. Resume explicitly; the paused message must not replay. New incoming text can reply again subject to configured cooldown/hours. Check another profile/chat cannot release the pause or use its delivery claim. Verify storage has hashes, timestamps and delivery/pause state, with no raw conversation/reply or model key. Revert to Draft only to disable automatic sending; verify saving unrelated profile fields preserves the selected mode.

## Cooldown regression 0.3.1

Keep the existing backend running, reload extension 0.3.1 and WhatsApp, and use a dedicated test chat. With the default ten-second interval, receive two new texts close together while a reply is being generated, then repeat just after a completed reply. The latest text should show Waiting to reply, continue without pressing Generate and receive one eligible reply after cooldown. It must not remain at ERROR/COOLDOWN or send the obsolete in-flight answer. Unknown facts still require human review.

Change Minimum time between replies in Reply preferences, save and reopen to verify persistence, including zero. While waiting, pause, switch chat, disable the assistant or reconnect: no queued reply should be sent. Resume/restart must not replay the queued message. An overlong configured interval or expired message must show an explanation and allow manual generation. Inspect storage for absence of the queued raw text and verify manually typed composer content remains intact.

## Unattended open-chat replies 0.3.2

Reload extension 0.3.2 and WhatsApp, keeping the paired backend running. Clear any draft left by an older failed attempt once; the new adapter cannot claim ownership of text inserted before it started. In opted-in Auto-reply, receive a new dedicated-test-chat message and touch no Generate, Insert or Send control. Verify generation, insertion, native send and cleared composer. Repeat with a multiline/emoji reply and an editor formatting change/remount; displayed text must remain exact. Ask an unsupported question: the fixed standard fallback should send automatically without claiming notification or ticket success. Manual generation must still produce a draft.

Type into an initially empty composer before a message arrives, and edit an automatic insertion while its Send button is delayed. Neither should send automatically, even if you restore the original words. Switching chat, replacing the footer, pausing, changing profile/settings or hiding the tab still blocks sending. Verify that an unknown existing draft that happens to equal the suggestion is preserved.

## Repeated-reply and worker-wakeup regression 0.3.3

Use a dedicated active test chat with the backend already paired. Receive a new message, verify an automatic send, then leave the chat idle and receive another new message without reconnecting or reloading. Repeat with identical text and a distinct message ID; each fresh event should be read and receive an eligible reply, subject to cooldown. In developer testing, stop the extension worker twice between replies and verify first/second/third automatic sends in the same chat. Inspect only the synthetic test account/page; do not browse other contacts for testing.

An equivalent sent-row replacement with the same unique public ID must not swallow the new appended incoming row. Replacing the entire list, switching chat/profile/configuration, or losing/duplicating the known tail anchor must retain conservative history baselining. Startup resume must reannounce metadata without replaying raw historical text; explicit Reconnect still resets/baselines. Verify duplicate node clones do not generate extra replies and that missing/old receivers still recover using the packaged content script. Model keys/pairing should remain unchanged.

## Backend restart and saved connection 0.3.4

Use a dedicated test business/chat. Start the rebuilt backend, open setup from that business's extension settings/error action, and verify the exact profile ID. Enter provider/model/key, keep Remember connection on this PC checked, save and pair once. Verify the input clears. Receive an eligible new message and verify one automatic send. Stop/start the backend using the desktop shortcut; do not enter another key or reconnect the extension. Receive a fresh incoming message: it should generate and send. Setup should retain provider/model, Remember and the same pairing, while its API-key input stays blank. Verify reload at narrow width preserves readable checkbox/layout.

Remove the saved model key, restart and confirm the previous pairing is rejected and the connection is absent. Repeat with Remember unchecked: the active session works, restart requires setup. Verify another business cannot use the first business's capability, and a corrupted/unwritable save file produces an actionable error without exposing its contents or claiming a successful save. Do not copy credential files or paste real keys into diagnostics. Inspect browser storage for absence of the provider key; local `.env.connections` must be Git-ignored and restricted to the operator. Missed/previously failed messages must not replay after restart. Provider-key rejection must have different guidance from pairing rejection.

## Repairing a Waiting adapter

After an extension rebuild, reload it in chrome://extensions, then reload WhatsApp Web and select a chat. Chrome does not replace already injected content code when the on-disk bundle changes. Existing messages remain baselined; send a new test message only after Chat ready.

Business settings → WhatsApp adapter diagnostics distinguishes no tab report from connected-but-unmatched chat selectors. No report: check the extension is enabled, website access allows web.whatsapp.com and the WhatsApp tab was reloaded. A report with missing chatHeader/messageList/composer: capture those group names for selector repair; incoming/outgoing/text groups can be absent in an empty chat. Readiness no longer waits for unrelated sidebar activity to stop. Exact built-in selector packs upgrade automatically while custom packs remain unchanged.

When no adapter report is available in 0.2.1+, click Reconnect WhatsApp. Verify it recovers without reloading the page, preserves composer text, baselines existing messages and processes only the next incoming text. If Chrome disabled the updated extension or denied website access, resolve that in extension Details first. A missing receiver, missing selector and AI-backend error are separate states.

For an unresolved incoming/outgoing selector mismatch in 0.2.3+, expand Copy structural diagnostic report and use Copy diagnostic report. Check installed/running adapter versions and saved selector version first. Share the report to diagnose active-list scope and wrapper metadata. Do not export the chat HTML or paste a provider key. This report does not include chat text or identifier values and is not automatically uploaded.
