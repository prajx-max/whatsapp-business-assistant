WhatsApp Business Assistant
<p align="center">
  <strong>An AI-powered assistant for managing customer conversations on WhatsApp Web.</strong>
  <br />
  Generate contextual replies, configure business-specific instructions, and automate eligible responses with an explicitly enabled auto-reply mode.
</p><p align="center">
  <img src="https://img.shields.io/badge/Platform-Chrome%20Extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Extension" />
  <img src="https://img.shields.io/badge/Manifest-V3-34A853?style=flat-square&logo=googlechrome&logoColor=white" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" />
</p>Overview
WhatsApp Business Assistant is a locally run AI assistant designed to help businesses handle incoming customer messages more efficiently.

It combines a Chrome Manifest V3 extension with a local backend that connects to supported AI providers. The assistant observes new incoming messages in the active WhatsApp Web chat, uses operator-configured business information and instructions to generate a response, and presents the result in the extension workspace.

The project supports two reply modes:
- Draft only: Generate an editable response for the operator to review and send manually. This is the default mode.
- Auto-reply: An explicitly enabled mode that can automatically send eligible replies for new incoming messages in the active chat, subject to the project's authorization and safety checks.
The goal is to make customer communication faster while keeping business-specific context, operator control, and privacy boundaries central to the design.
Key Features
AI-powered replies
- Generate context-aware responses to new incoming WhatsApp messages.
- Use configurable business instructions and business information.
- Connect supported OpenAI, Google Gemini, and Anthropic models.
- Keep generated responses editable in Draft only mode.
- Use conservative fallback responses when confirmed business information is unavailable.
WhatsApp Web integration
- Chrome Extension built on Manifest V3.
- Observe new incoming messages in the active chat.
- Ignore outgoing messages and existing chat history during baseline initialization.
- Detect and deduplicate message events.
- Display chat readiness and adapter diagnostics.
- Insert generated text into the WhatsApp composer with context checks.
Reply preferences and automation
- Draft only is the default.
- Auto-reply requires a separate operator opt-in and explicit sending consent.
- Configure reply timing and working hours.
- Pause and resume automatic replies for individual chats.
- Revalidate the active chat, source message, composer and authorization before an automatic send.
- Manual generation remains a draft.
Local AI configuration
- Local setup interface for provider, model and API key configuration.
- Profile-scoped extension/backend pairing.
- Option to remember a connection on the local machine.
- Provider credentials remain on the backend and are not sent to the browser extension.
- Session-only configuration is also supported.
Architecture
The project uses a pnpm monorepo structure.
whatsapp-business-assistant/
│
├── apps/
│   ├── api/                  # Local AI backend and setup interface
│   └── extension/            # Chrome Manifest V3 extension
│
├── packages/
│   ├── contracts/            # Shared Zod schemas and TypeScript contracts
│   ├── core/                 # Business rules and assistant logic
│   ├── knowledge/            # Knowledge and retrieval boundaries
│   ├── ui/                   # Shared UI components
│   └── test-fixtures/        # Synthetic test data and DOM fixtures
│
├── docs/                     # Product, architecture and release documentation
├── e2e/                      # End-to-end tests
├── scripts/                  # Build verification scripts
│
├── .env.example              # Example backend configuration
├── package.json
├── pnpm-workspace.yaml
└── README.md
Request flow
Customer
   │
   ▼
WhatsApp Web
   │
   ▼
Chrome Extension
   │
   ├── Detect new incoming message
   ├── Identify active chat and business profile
   └── Validate message context
          │
          ▼
     Local API Backend
          │
          ├── Business instructions
          ├── Configured business information
          └── Selected AI provider
                 │
                 ▼
          AI Response Generation
                 │
                 ▼
          Response Validation
                 │
                 ▼
          Extension Workspace
                 │
          ┌──────┴────────┐
          ▼               ▼
       Draft only       Auto-reply
          │               │
          ▼               ▼
    Human review     Authorization checks
          │               │
          ▼               ▼
    Manual send      WhatsApp send action
Tech Stack
Layer	Technologies
Language	TypeScript
Frontend	React 19
Extension	Chrome Manifest V3
Build tooling	Vite 8
Backend	Node.js 24, native HTTP and Fetch
Validation	Zod
AI providers	OpenAI, Google Gemini, Anthropic
Package manager	pnpm 11
Testing	Vitest, React Testing Library, Playwright
Code quality	ESLint, Prettier, TypeScript


Getting Started
Prerequisites
Install the following:
- Node.js 24
- pnpm 11
- Google Chrome
- An API key from one of the supported AI providers
The repository pins Node.js 24.22.1 and pnpm 11.25.0.
1. Clone the repository
git clone https://github.com/prajx-max/whatsapp-business-assistant.git
cd whatsapp-business-assistant
2. Install dependencies
pnpm install --frozen-lockfile
3. Configure the backend
Copy the example environment file:

Windows PowerShell
Copy-Item .env.example .env
macOS / Linux
cp .env.example .env
The example contains optional first-use settings:
API_PORT=3000
LLM_PROVIDER=openai
LLM_MODEL=
LLM_API_KEY=
ASSISTANT_PROFILE_ID=sweet-crumbs-demo
You can also configure your provider, model and API key through the local setup page. This is the recommended setup flow.

Never commit real API keys or share your local credential files.
4. Build the extension
pnpm --filter @assistant/extension build
The production extension is generated at:
apps/extension/dist
5. Start the backend
From the repository root:
pnpm dev:api
The local setup page is available at:

http://127.0.0.1:3000/setup

Configure your AI provider, select a supported model, enter your API key, and complete the extension pairing process.
6. Load the Chrome extension
1. Open Google Chrome.
2. Navigate to chrome://extensions.
3. Enable Developer mode.
4. Select Load unpacked.
5. Choose the apps/extension/dist folder.
6. Reload WhatsApp Web if it is already open.
7. Configure your business
1. Open the extension's business settings.
2. Add your business information and reply instructions.
3. Pair the extension with the local backend.
4. Configure reply preferences and working hours.
5. Open WhatsApp Web and wait for the active chat to become ready.
6. Test the assistant using a new incoming message.
Keep the backend running while using the extension.
Reply Modes
Mode	Behaviour
Draft only	Generates an editable draft; the operator reviews and sends it
Auto-reply	Automatically sends eligible replies after explicit opt-in and authorization checks
Off	Disables assistant reply actions


Important: Auto-reply is not enabled by default. It requires explicit operator consent. It is limited to fresh incoming messages in the active chat; it is not a bulk messaging or inactive-chat monitoring system.
Privacy and Security
Security and privacy are important architectural considerations.
- API keys are kept in backend configuration and are not exposed to the extension.
- The backend binds to 127.0.0.1, rather than exposing the local API to the network.
- Extension/backend communication uses profile-scoped pairing capabilities.
- Incoming messages and generated replies are kept in memory rather than persisted as customer conversation history.
- Existing chat history is baselined instead of processed as new messages.
- Chat identifiers are hashed and scoped to the business profile.
- External text is treated as untrusted input.
- Automatic sending requires fresh context and authorization checks.
- The optional remembered connection is stored in a Git-ignored local backend configuration file. It is not an encrypted credential vault.
Never commit .env, .env.connections, API keys, pairing credentials, or real customer data.
Current Scope and Limitations
The repository is an actively developed project. The current implementation includes the Chrome extension, WhatsApp Web adapter, local AI backend, provider setup, business instructions, guarded draft insertion and explicitly opted-in Auto-reply.

The following capabilities remain planned or outside the current implementation boundary:
- Full Google Sheets integration and knowledge-source mapping.
- Complete structured knowledge retrieval and synchronization.
- Durable ticket management and team notifications.
- Persistent follow-up scheduling and workflow alarms.
- Full multi-profile onboarding and hosted authentication.
- Official WhatsApp Business Platform transport.
- Production-scale deployment and security audit.
The current business knowledge input is operator-configured information, not a complete retrieval system. Response validation uses conservative checks and does not guarantee semantic correctness. WhatsApp Web DOM changes can also affect adapter compatibility.
Development
Useful commands:
Command	Description
pnpm dev:api	Build and start the local API
pnpm --filter @assistant/extension dev	Start the extension development server
pnpm --filter @assistant/extension build	Build the production extension
pnpm format	Format project files
pnpm format:check	Check formatting
pnpm lint	Run ESLint
pnpm typecheck	Run TypeScript checks
pnpm test	Run unit and integration tests
pnpm test:e2e	Run Playwright end-to-end tests
pnpm build	Build project packages and verify artifacts
pnpm check	Run the complete verification suite


Contributing
Contributions, bug reports and suggestions are welcome.
1. Fork the repository.
2. Create a feature branch.
3. Make focused changes and add relevant tests.
4. Run pnpm check.
5. Submit a pull request with a clear description of the changes.
Please review the project documentation in the docs/ directory before making architectural changes.
License
No license has currently been specified for this repository. All rights are reserved by default unless a license is added by the repository owner.
<p align="center">
  Built to make business conversations smarter, faster, and more manageable.
</p>
