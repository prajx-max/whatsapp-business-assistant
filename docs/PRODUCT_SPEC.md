# Product specification

## Goal

One business assistant for bakeries, service centres, e-governance portals, real estate and other businesses. Profiles control knowledge sources, reply rules, languages, tone, hours, thresholds, escalation, and privacy. The original detailed requirements are in [the source workflow](BUILD_WORKFLOW_SOURCE.md).

## Required behavior

Only new incoming messages in the active WhatsApp Web chat are observed. Retrieved knowledge supplies exact facts. The assistant classifies intent and importance, proposes an editable reply in the supported customer language, and offers human takeover or ticket creation when needed.

Supported initial languages: English, Kannada, Telugu, Tamil and Hindi. Preserve exact names, prices, dates, URLs and IDs. Unknown facts must trigger fallback rather than invention.

WhatsApp Web defaults to `DRAFT_ONLY`, with explicit user send. The user authorized a distinct, explicitly opted-in `AUTO_REPLY_WEB` mode on 2026-11-01. It sends eligible replies only for fresh incoming text in the active chat, with source binding, duplicate reservation and persistent per-chat pause. `OFF` disables actions. `AUTO_SAFE_OFFICIAL_TRANSPORT` remains reserved for the future official transport.

## Priority and process flow

HIGH includes payment failures, refunds, complaints, privacy concerns, damage and urgent unresolved issues. FOLLOW_UP includes processes, status, callbacks, quotes and document clarification. NORMAL includes price, availability, product details, hours and greetings. Labels belong to the extension.

Process enquiries first produce an acknowledgement draft. Persist a ticket, attempt team notification, and schedule a configurable follow-up only after success. The default delay is approximately two minutes. A web follow-up becomes a high-priority draft and browser notification. Human takeover blocks automatic actions and requires explicit release.

If notification fails after saving a ticket, say the request was saved for manual review. If saving itself fails, do not claim it was saved. A notification receipt alone does not establish that a callback is guaranteed; callback wording must match the business's verified policy.

## Screens and sources

Popup: enable, active profile, connection/sync status and mode. Side panel: active chat, latest message, language, intent, priority, confidence, citations, draft editor, insert/send, ticket, takeover and follow-up state. Options: profiles, Sheets connection, mapping, languages, hours, rules, privacy and validated import/export. Separate important-query inbox and diagnostics.

Initial providers are static JSON, Apps Script JSON, and public Sheets. The mapping wizard previews ten rows, suggests and allows correction of mappings, reports every invalid row and saves mappings by profile. Cache last-known-good data and sync metadata.

## Current implementation boundary

The current authorized boundary includes the MV3 shell, thin WhatsApp adapter, local AI backend and model-key interface, described below. The fictional bakery sample remains optional and isolated. Full retrieval, Sheets, tickets and scheduling are still roadmap work.

Remaining behavior is planned until the corresponding roadmap gate is verified. Contract validation is not a replacement for runtime authorization, grounding, privacy enforcement, or workflow state validation.

## Current adapter and AI release

The user-authorized combined release adds live new incoming-text observation, consented/manual AI suggestions, editable business instructions/information, backend API-key setup and pairing, and guarded draft insertion. Keys stay in backend environment variables. The extension uses profile-scoped capability tokens; raw live text and generated replies remain memory-only. Automated verification uses a synthetic WhatsApp page and injected model responses.

The knowledge input is currently a single structured record containing operator-entered business information. It is not a Sheets provider, row mapper or full retrieval engine. Exact numeric/URL guards and evidence references are conservative checks, not proof that a generated answer is true. Draft only retains human review. Opt-in Auto-reply generates and sends supported replies without per-message clicks. When confirmed information is missing, it sends the worker's fixed localized fallback; it never automatically sends unsupported provider output. Manual generation remains a draft. Per-chat pause persists across worker restart and requires explicit resume. Tickets, notifications and scheduling remain planned; the generator must not claim those actions succeeded.

Closely spaced new messages are coalesced into the latest pending message while another automatic request is running or a chat cooldown is active. The workspace shows Waiting to reply and continues automatically, preserving the configured interval. Reply preferences expose that interval. Queued text remains in memory, expires within the existing source freshness limit and is canceled by takeover, chat/profile/settings changes, reconnect or restart. This is live-reply throttling, not the future follow-up scheduler.

Repeated messages in the same open chat must continue to work after a completed reply or service-worker restart. A healthy content observer retains its baseline/deduplication state on worker wakeup, re-registers context and accepts only newly observed events. The worker does not restore raw text or replay past messages. A same-container row replacement can preserve continuity only with a unique previously observed public tail ID; otherwise it remains a conservative rebaseline.

Local model setup offers Remember connection on this PC, retaining the same provider/model/key and profile-scoped pairing across backend restarts in private backend environment configuration. Session-only storage remains available. No provider key is returned to the extension or stored in the browser. Removal revokes the saved connection durably; save failure must not report success or change the live connection. Old expired session-only connections require one configure/pair step on upgrade. The extension explains pairing failures separately from rejected model keys and links setup for the exact active business. New incoming messages can continue after restart without reconnecting a remembered connection; unavailable-period messages are not replayed.
