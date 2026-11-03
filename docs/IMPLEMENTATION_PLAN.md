# Implementation plan

## Starting point and assumptions

The workspace was empty when inspected on 2026-10-24. Use the existing folder as the repository root. The supplied workflow starts with Milestone 0 and requires stopping at each milestone boundary. No credentials, live WhatsApp account, deployment, or external team notification is required yet.

## Milestone 0 plan

1. Initialize Git and scaffold pnpm workspace boundaries for both apps and five packages.
2. Configure strict TypeScript, ESLint, Prettier, Vitest, shared scripts, and Windows/Linux CI.
3. Define runtime-validated profile, knowledge, message, decision, ticket, follow-up, API, and versioned extension event contracts.
4. Test invalid boundary input, privacy defaults, manual-send markers, exact answer text, and notification metadata requirements.
5. Document the specification, architecture, security constraints, testing, and release gates.
6. Install dependencies, run every check, inspect generated exports and Git diff, and record results.
7. Commit the verified milestone and stop. The next milestone begins after review.

## Roadmap

Milestone 0 is committed at `37e7760`. Milestone 1 implementation plan: extend the workspace with React/Vite browser builds; add a minimal MV3 manifest and three pages; persist validated profile settings through a trusted worker router; deliver a clearly fictional typed sample reply; test storage, routing, UI and a real unpacked Chromium load; document installation and stop before DOM observation.

Milestone 1 is implemented and verified: 52 unit/UI tests, the production bundle and an unpacked Chromium workflow pass. See [the Milestone 1 report](MILESTONE_1_REPORT.md) for evidence, installation and limitations. The next implementation boundary is Milestone 2.

| Milestone | Deliverable                                          | Acceptance gate                                           |
| --------- | ---------------------------------------------------- | --------------------------------------------------------- |
| 0         | Repository, contracts, docs, CI                      | Install, format, lint, types, tests, build                |
| 1         | MV3 shell, worker, popup, panel, settings, typed bus | Load unpacked, persistent profile, mock flow              |
| 2         | Thin WhatsApp adapter and local fixture              | Ignore history/outgoing; detect once; manual draft/send   |
| 3         | Static knowledge, mapping, lexical retrieval         | Exact facts, safe unknowns, multilingual retrieval        |
| 4         | Sheets providers, wizard, cache and sync             | Visible validation errors, offline fallback, isolation    |
| 5         | Importance, tickets, takeover, alarms                | Truthful success/failure, idempotency, restart recovery   |
| 6         | Secure API, grounded AI, evaluations                 | Secrets stay server-side, safe failures, 60 eval cases    |
| 7         | Multi-profile onboarding and migration               | Profile-specific knowledge, settings and strict isolation |
| 8         | Security, accessibility, release, official mock      | Audit, diagnostic redaction, release checklist            |

## Decisions deferred

React/Vite extension bundling is selected and pinned when the shell is introduced. Fastify, SQLite repository adapters, LLM SDKs, and notification integrations are selected when their milestones begin. Private Google OAuth remains an interface until explicitly implemented. Real account or notification tests require a dedicated setup; CI uses local fixtures.

## Authorized adapter and AI release — 2026-10-28

The user explicitly requested the WhatsApp adapter, AI backend, predefined business instructions and a model API-key interface together. This authorizes one combined release across the adapter and selected AI milestone scope, overriding the usual one-milestone stop for this request only. It does not complete every feature in milestones 3–8.

Implemented scope: baseline/observe new incoming text, ordered selector diagnostics, hashed chat identity, stale-safe draft insertion, profile instructions and one operator-entered knowledge record, loopback API, OpenAI/Gemini/Anthropic providers, backend-only runtime keys, pairing, manual or consented generation, and fixture/browser verification. There is no programmatic web send. The operator sends from WhatsApp itself.

Deferred: full retrieval/mapping/Sheets, durable repositories, tickets/notifications, takeover and alarms, profile creation/import, hosted multi-user auth, live multilingual quality evaluations, official transport and production release audit. Native Node HTTP and fetch replace a framework/SDK dependency for this bounded local service; SQLite remains deferred because no customer-message persistence is introduced.

Stop at this integrated boundary after verification and handoff. The next milestone should be selected explicitly. See [release report](WHATSAPP_AI_RELEASE_REPORT.md).

## Authorized web Auto-reply extension — 2026-11-01

After live reading and AI generation worked, the user explicitly chose “Send automatically—change the project rule”. This authorizes one bounded extension release, 0.3.0, superseding the earlier manual-only web rule. It does not authorize the remaining roadmap or reinterpret the official transport mode.

Scope: distinct `AUTO_REPLY_WEB` and separate profile consent; default DRAFT_ONLY and existing settings preserved; generation-only backend compatibility; active-tab/source/composer revalidation and fresh worker authorization; persisted hash-only delivery reservation before Send; fail-closed handling of ambiguous attempts; persistent per-profile/chat pause with explicit resume; visible draft/sending/sent/blocked/unconfirmed states. Automatic generation occurs only for new incoming events. Manual retry produces a draft. Saving settings, reconnecting, resuming and restarting never replay history.

Acceptance: meaningful regressions for disabled mode, missing consent, inactive tab, human-help replies, working hours, source edits/removal, later messages/operator replies, manual composer edits, settings/takeover races, storage failure, profile isolation, duplicate delivery and worker restart; a synthetic unpacked Chrome workflow verifies zero default sends, one opted-in send and pause behavior. Complete all repository checks and stop at this boundary. Sheets, tickets, notifications, alarms, inactive-chat monitoring, bulk sending, hosting and official transport remain deferred.

## Current repair boundary — cooldown continuation 0.3.1

The user's next defect report shows COOLDOWN after two incoming messages. Reproduce the interrupted-generation failure, then fix only live-reply throttling: coalesce pending text to the latest event, wait without invalidating both replies, continue automatically after the configured generation/send cooldown, expose the interval and a truthful waiting state, and preserve all send/ownership/privacy gates. Bounded transport rechecks may advance in-memory work; no alarm permissions, historical reads or durable raw-text scheduling are introduced.

Acceptance: regression coverage for an in-flight second message, a burst after a completed send, zero cooldown, duplicate events, wrong-owner polling, cancellation, freshness expiry, worker recreation and settings persistence; the unpacked Chromium workflow must receive two texts inside the actual cooldown and send only the latest queued reply without a manual Generate action. Verify the full repository checks, rebuild the production artifact, document limitations and stop. Remaining roadmap boundaries are unchanged.

## Current repair boundary — unattended open-chat replies 0.3.2

The user confirmed generation works and requested replies without Generate/Insert/Send clicks; their screenshot shows COMPOSER_BUSY with the generated text still in the composer. Reproduce raw-text/editor-identity false failures, then retain scoped ownership of an insertion into an initially empty composer while tolerating equivalent formatting and editor remounts. Real editing, footer/context changes and all existing send gates must still cancel. Auto-reply may use only the existing fixed localized fallback when a response needs human help; manual/DRAFT_ONLY generation stays a draft. This does not authorize inactive-chat monitoring, bulk messaging, unknown-draft adoption, action claims, or durable follow-ups.

Acceptance: unit and actual Chromium tests for NBSP/paragraph representations, editor replacement, exact draft identity, automatic fallback, preservation of pre-existing text, and trusted editing followed by restored text. Keep API pairing/backend credentials unchanged, run the full repository checks, rebuild version 0.3.2 and stop at this repair boundary.

## Current repair boundary — repeated replies and worker wakeup 0.3.3

The user reports that the first automatic reply succeeds but a later new message is lost, with the workspace reset to Waiting. Reproduce startup resetting an existing observer and a sent tail-row remount swallowing the subsequent incoming row. Split automatic startup resume from explicit baseline reset; force context registration before every new event; preserve same-container row continuity only through a unique known public tail ID. Retain conservative baselines for missing/ambiguous anchors, changed chats/configuration and fresh installs. No history replay, raw-text persistence, keepalive permissions, provider changes or inactive-chat automation.

Acceptance: regressions for resume without history extraction, repeated identical text with distinct IDs, unchanged-diagnostics context registration, changed-profile resume, ambiguous anchors and older/missing bridges. Actual Chromium must send first/second/third replies in the same chat while the extension worker is stopped and woken twice and sent rows are remounted. Run all required checks, rebuild 0.3.3, document the verified scope and stop.

## Current repair boundary — restart-stable backend connection 0.3.4

The user reports UNAUTHORIZED after repeated backend restarts and requests a lasting fix. The existing session-only provider configuration and random pairing are lost on every backend exit. Add an explicit Remember connection on this PC setup choice that saves only backend environment configuration (provider, model, profile ID, key and stable pairing), with private file permissions, validated bounded load, atomic writes, truthful failures, persistent revocation and a session-only option. Keep provider keys out of extension/browser storage and logs. The extension must explain pairing failure separately from rejected provider keys and open setup for the active profile. No anonymous re-pair, authentication bypass, historical replay or customer-text persistence.

Acceptance: real HTTP tests across backend recreation preserve the same pairing and provider credentials, reject cross-profile ownership, persist removal, preserve active configuration after save failure, and refuse corrupted files without secret echoes. The unpacked Chromium workflow must receive and automatically answer a fresh message after the backend is closed/recreated without entering a key or reconnecting the extension. Run all required checks, rebuild 0.3.4, document the one-time upgrade setup and stop. Sheets, hosted auth, tickets and other roadmap work remain deferred.
