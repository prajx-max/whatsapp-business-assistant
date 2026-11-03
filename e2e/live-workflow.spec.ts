import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackend } from '../apps/api/dist/index.js';
import type { GenerationInput } from '../apps/api/src/providers/llm/provider.js';

test('paired adapter: draft-only insertion, recovery, opt-in auto-reply and chat pause', async () => {
  const inputs: GenerationInput[] = [];
  const connectionDirectory = await mkdtemp(
    join(tmpdir(), 'assistant-browser-restart-'),
  );
  const connectionFile = join(connectionDirectory, '.env.connections');
  const createTestBackend = () =>
    createBackend({
      port: 4175,
      connectionFile,
      provider: {
        async generate(input) {
          inputs.push(input);
          if (input.input.includes('Unknown service question'))
            return {
              reply: 'An unsupported answer',
              needsHuman: true,
              evidenceIds: [],
            };
          if (input.input.includes('Multiline service question'))
            return {
              reply:
                'Hello! 👋\n\nChocolate Truffle Cake costs ₹650 for 500 grams.\nEggless is available.',
              needsHuman: false,
              evidenceIds: ['business-information'],
            };
          return input.input === 'Check connection.'
            ? { reply: 'Ready', needsHuman: true, evidenceIds: [] }
            : {
                reply:
                  'Chocolate Truffle Cake costs ₹650 for 500 grams. Eggless is available.',
                needsHuman: false,
                evidenceIds: ['business-information'],
              };
        },
      },
    });
  let backend = createTestBackend();
  await backend.listen();
  const fixture = createServer((request, response) => {
    const file =
      request.url === '/fixture.js'
        ? 'fixture.js'
        : request.url === '/fixture.css'
          ? 'fixture.css'
          : 'index.html';
    response.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : 'text/html',
    );
    void readFile(resolve('packages/test-fixtures/whatsapp-page', file)).then(
      (buffer) => response.end(buffer),
      () => {
        response.writeHead(500);
        response.end();
      },
    );
  });
  await new Promise<void>((accept, reject) => {
    fixture.once('error', reject);
    fixture.listen(4174, '127.0.0.1', () => accept());
  });
  const browserPath = resolve('.browser-cache/chrome-win64/chrome.exe');
  const executablePath =
    process.env.CHROMIUM_EXECUTABLE_PATH ??
    (process.platform === 'win32' && existsSync(browserPath)
      ? browserPath
      : undefined);
  const extensionPath = resolve('apps/extension/dist-fixture');
  const context = await chromium.launchPersistentContext('', {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  context.setDefaultTimeout(10000);
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).hostname;
    const setup = await context.newPage();
    let releaseSetup: () => void = () => undefined;
    const setupGate = new Promise<void>((accept) => {
      releaseSetup = accept;
    });
    await setup.route('**/setup/state?*', async (route) => {
      const response = await route.fetch();
      await setupGate;
      await route.fulfill({ response });
    });
    await setup.goto('http://127.0.0.1:4175/setup');
    await expect(setup.getByLabel('Model ID', { exact: true })).toBeDisabled();
    releaseSetup();
    await setup.getByLabel('Model ID', { exact: true }).fill('fixture-model');
    await setup
      .getByLabel('Model API key', { exact: true })
      .fill('fixture-provider-key-not-real');
    await expect(
      setup.getByRole('checkbox', { name: 'Remember connection on this PC' }),
    ).toBeChecked();
    await setup.getByRole('button', { name: /Save model connection/ }).click();
    await expect(
      setup.getByText('Model connection saved.', { exact: false }),
    ).toBeVisible();
    await expect(
      setup.getByLabel('Model API key', { exact: true }),
    ).toHaveValue('');
    const pairingCode = await setup
      .getByLabel('Extension pairing code')
      .inputValue();
    expect(pairingCode.length).toBeGreaterThan(32);
    await setup.getByRole('button', { name: 'Test model connection' }).click();
    await expect(setup.getByText(/Model connection works/)).toBeVisible();

    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options
      .getByRole('textbox', { name: /^Reply instructions/ })
      .fill(
        'Reply politely. Keep replies concise. Use only confirmed business facts.',
      );
    await options
      .getByRole('textbox', { name: /^Business information/ })
      .fill(
        'Chocolate Truffle Cake costs ₹650 for 500 grams. Eggless is available.',
      );
    await options.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      options.getByText('Settings saved', { exact: true }),
    ).toBeVisible();
    await options
      .getByRole('textbox', { name: /^Backend pairing code/ })
      .fill(pairingCode);
    await options
      .getByRole('checkbox', {
        name: /^Suggest replies to new incoming messages/,
      })
      .check();
    await options
      .getByRole('button', { name: 'Connect AI backend', exact: true })
      .click();
    await expect(options.getByText('Connected', { exact: true })).toBeVisible();
    await expect(
      options.getByRole('textbox', { name: /^Backend pairing code/ }),
    ).toHaveValue('');
    const stored = await options.evaluate(async () =>
      JSON.stringify(await chrome.storage.local.get(null)),
    );
    expect(stored).not.toContain('fixture-provider-key-not-real');

    const chat = await context.newPage();
    await chat.goto(
      'http://127.0.0.1:4174/?themeRows&rewriteComposer&remountTail',
    );
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 420, height: 980 });
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await expect(panel.getByText('Chat ready', { exact: true })).toBeVisible();
    expect(
      inputs.filter((entry) => entry.input !== 'Check connection.'),
    ).toHaveLength(0);
    await chat
      .getByRole('button', { name: 'Receive incoming message', exact: true })
      .click();
    await expect(
      panel.getByRole('textbox', { name: /^Live suggested reply/ }),
    ).toHaveValue(/₹650 for 500 grams/);
    const generated = inputs.filter(
      (entry) => entry.input !== 'Check connection.',
    );
    expect(generated).toHaveLength(1);
    expect(generated[0]?.system).toContain(
      'Reply politely. Keep replies concise.',
    );
    expect(generated[0]?.input).not.toContain('An old message already present');
    await options
      .getByText('Copy structural diagnostic report', { exact: true })
      .click();
    const report = await options
      .getByRole('textbox', {
        name: 'Structural diagnostic report',
        exact: true,
      })
      .inputValue();
    const metadata = JSON.parse(report) as {
      installedVersion: string;
      savedSelectorVersion: number;
      structure: {
        buildVersion: string;
        incomingNodesInList: number;
        textNodesInList: number;
      };
    };
    expect(metadata.installedVersion).toBe('0.3.4');
    expect(metadata.savedSelectorVersion).toBe(4);
    expect(metadata.structure.buildVersion).toBe('0.3.4');
    expect(metadata.structure.incomingNodesInList).toBeGreaterThan(0);
    expect(metadata.structure.textNodesInList).toBeGreaterThan(0);
    expect(report).not.toContain(
      'What is the price of Chocolate Truffle Cake?',
    );
    expect(report).not.toContain('fixture-provider-key-not-real');
    expect(report).not.toContain(pairingCode);
    await mkdir('artifacts/whatsapp-ai', { recursive: true });
    await panel.screenshot({
      path: 'artifacts/whatsapp-ai/live-workspace.png',
      fullPage: true,
    });
    await options.screenshot({
      path: 'artifacts/whatsapp-ai/business-settings.png',
      fullPage: true,
    });
    await setup.screenshot({
      path: 'artifacts/whatsapp-ai/key-setup.png',
      fullPage: true,
    });

    // Exercise the same trusted extension-page route with the fixture tab active.
    // Default Draft only writes the synthetic composer without clicking Send.
    const snapshot = await panel.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({
          type: 'GET_STATE',
          version: 1,
        })) as {
          state: { live: { suggestion: { id: string; reply: string } } };
        },
    );
    await chat.bringToFront();
    const inserted = await panel.evaluate(
      async (suggestion) =>
        (await chrome.runtime.sendMessage({
          type: 'INSERT_LIVE_DRAFT',
          version: 1,
          suggestionId: suggestion.id,
          text: suggestion.reply,
          approval: 'EXPLICIT_USER_CLICK',
        })) as { ok: boolean },
      snapshot.state.live.suggestion,
    );
    expect(inserted.ok).toBe(true);
    await expect(
      chat.getByRole('textbox', { name: 'Message composer' }),
    ).toHaveText(/₹650\sfor\s500\sgrams/);
    await expect(chat.locator('#sent')).toHaveText('0');

    await chat
      .getByRole('button', { name: 'Duplicate last incoming node' })
      .click();
    await chat.getByRole('button', { name: 'Add outgoing message' }).click();
    await chat.getByRole('button', { name: 'Prepend older history' }).click();
    await chat.getByRole('button', { name: 'Switch chat' }).click();
    await expect(
      panel.getByRole('heading', { name: 'Fixture customer B', exact: true }),
    ).toBeVisible();
    await expect(panel.getByText('Chat ready', { exact: true })).toBeVisible();
    expect(
      inputs.filter((entry) => entry.input !== 'Check connection.'),
    ).toHaveLength(1);
    await expect(
      panel.getByRole('textbox', { name: /^Live suggested reply/ }),
    ).toHaveCount(0);
    const finalStorage = await options.evaluate(async () =>
      JSON.stringify(await chrome.storage.local.get(null)),
    );
    expect(finalStorage).not.toContain(
      'What is the price of Chocolate Truffle Cake?',
    );
    expect(finalStorage).not.toContain('fixture-provider-key-not-real');
    await options.setViewportSize({ width: 360, height: 950 });
    await expect
      .poll(() =>
        options.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      )
      .toBe(true);
    await options.screenshot({
      path: 'artifacts/whatsapp-ai/business-settings-mobile.png',
      fullPage: true,
    });

    // Simulate a missing receiver in the synthetic page, then recover through
    // the real trusted UI and packaged-script injection (no chat reload).
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1:4174/*' });
      if (tab?.id === undefined) throw new Error('Missing synthetic tab');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        func: () => {
          const bridge = globalThis as typeof globalThis & {
            __universalAssistantDispose?: () => void;
          };
          bridge.__universalAssistantDispose?.();
        },
      });
    });
    await panel.evaluate(async () =>
      chrome.runtime.sendMessage({
        type: 'SET_ENABLED',
        version: 1,
        enabled: true,
      }),
    );
    await panel
      .getByRole('button', { name: 'Reconnect WhatsApp', exact: true })
      .click();
    await expect(panel.getByText('Chat ready', { exact: true })).toBeVisible();
    expect(
      inputs.filter((entry) => entry.input !== 'Check connection.'),
    ).toHaveLength(1);
    await chat
      .getByRole('button', { name: 'Receive incoming message', exact: true })
      .click();
    await expect(
      panel.getByRole('textbox', { name: /^Live suggested reply/ }),
    ).toHaveValue(/₹650 for 500 grams/);
    expect(
      inputs.filter((entry) => entry.input !== 'Check connection.'),
    ).toHaveLength(2);

    // Switch to a new chat to exercise automatic delivery without the earlier
    // chat's configured cooldown. No real WhatsApp account or model is used.
    await options.setViewportSize({ width: 1100, height: 950 });
    await options.getByRole('radio', { name: /^Auto-reply/ }).check();
    await options
      .getByRole('checkbox', {
        name: /^Allow automatic sending without review/,
      })
      .check();
    await options.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      options.getByText('Settings saved', { exact: true }),
    ).toBeVisible();
    await chat.bringToFront();
    await chat.getByRole('button', { name: 'Switch chat' }).click();
    await expect(
      panel.getByRole('heading', { name: 'Fixture customer C', exact: true }),
    ).toBeVisible();
    await expect(panel.getByText('Chat ready', { exact: true })).toBeVisible();
    await chat
      .getByRole('button', { name: 'Receive incoming message', exact: true })
      .click();
    await expect(chat.locator('#sent')).toHaveText('1');
    await expect(
      chat.getByRole('textbox', { name: 'Message composer' }),
    ).toBeEmpty();
    await expect(
      panel.getByRole('button', { name: 'Sent to WhatsApp', exact: true }),
    ).toBeDisabled();
    await expect(panel.getByText('Enabled', { exact: true })).toBeVisible();
    await panel.screenshot({
      path: 'artifacts/whatsapp-ai/auto-reply-sent.png',
      fullPage: true,
    });
    expect(
      inputs.filter((entry) => entry.input !== 'Check connection.'),
    ).toHaveLength(3);
    // Reproduce two messages arriving inside the real ten-second cooldown.
    // The packaged content bridge must advance the pending worker queue itself.
    async function stopExtensionWorker() {
      const lifecycle = await context.newCDPSession(panel);
      let workerVersion: string | undefined;
      let stopped = false;
      lifecycle.on(
        'ServiceWorker.workerVersionUpdated',
        (event: {
          versions: {
            versionId: string;
            scriptURL: string;
            runningStatus: string;
          }[];
        }) => {
          for (const version of event.versions)
            if (version.scriptURL === worker.url()) {
              workerVersion = version.versionId;
              if (version.runningStatus === 'stopped') stopped = true;
            }
        },
      );
      await lifecycle.send('ServiceWorker.enable');
      await expect.poll(() => workerVersion).toBeTruthy();
      if (!workerVersion)
        throw new Error('Missing synthetic extension worker version');
      stopped = false;
      await lifecycle.send('ServiceWorker.stopWorker', {
        versionId: workerVersion,
      });
      await expect.poll(() => stopped).toBe(true);
      await lifecycle.detach();
    }
    await stopExtensionWorker();
    await chat
      .getByRole('textbox', { name: 'Customer message' })
      .fill('First question in the burst');
    await chat
      .getByRole('button', { name: 'Receive incoming message', exact: true })
      .click();
    await expect(
      panel.getByRole('button', { name: 'Waiting to reply…', exact: true }),
    ).toBeDisabled();
    await chat
      .getByRole('textbox', { name: 'Customer message' })
      .fill('Latest question in the burst');
    await chat
      .getByRole('button', { name: 'Receive incoming message', exact: true })
      .click();
    await expect(
      panel.getByText('Latest question in the burst', { exact: true }),
    ).toBeVisible();
    await expect(chat.locator('#sent')).toHaveText('1');
    expect(
      inputs.filter((entry) => entry.input !== 'Check connection.'),
    ).toHaveLength(3);
    await panel.screenshot({
      path: 'artifacts/whatsapp-ai/cooldown-waiting.png',
      fullPage: true,
    });
    await expect(chat.locator('#sent')).toHaveText('2', { timeout: 20000 });
    await expect(
      panel.getByRole('button', { name: 'Sent to WhatsApp', exact: true }),
    ).toBeDisabled();
    expect(
      inputs.filter((entry) => entry.input !== 'Check connection.'),
    ).toHaveLength(4);
    expect(inputs.at(-1)?.input).toContain('Latest question in the burst');
    expect(inputs.at(-1)?.input).not.toContain('First question in the burst');
    await panel.screenshot({
      path: 'artifacts/whatsapp-ai/cooldown-sent.png',
      fullPage: true,
    });
    // Stop it again, then receive identical text with a fresh public ID in the
    // same chat. A successful second reply must not make the third one vanish.
    await stopExtensionWorker();
    await chat
      .getByRole('button', { name: 'Receive incoming message', exact: true })
      .click();
    await expect(chat.locator('#sent')).toHaveText('3', { timeout: 20000 });
    await expect(
      panel.getByRole('button', { name: 'Sent to WhatsApp', exact: true }),
    ).toBeDisabled();
    expect(
      inputs.filter((entry) => entry.input !== 'Check connection.'),
    ).toHaveLength(5);
    await panel.screenshot({
      path: 'artifacts/whatsapp-ai/repeated-replies-after-restart.png',
      fullPage: true,
    });
    // Restart the actual HTTP service with the saved backend environment file.
    // The existing extension pairing must work without reconnecting or refilling a key.
    await backend.close();
    backend = createTestBackend();
    await backend.listen();
    await setup.reload();
    await expect(setup.getByLabel('Extension pairing code')).toHaveValue(
      pairingCode,
    );
    await expect(
      setup.getByRole('checkbox', { name: 'Remember connection on this PC' }),
    ).toBeChecked();
    await expect(
      setup.getByLabel('Model API key', { exact: true }),
    ).toHaveValue('');
    await chat.bringToFront();
    await chat
      .getByRole('textbox', { name: 'Customer message' })
      .fill('New question after backend restart');
    await chat
      .getByRole('button', { name: 'Receive incoming message', exact: true })
      .click();
    await expect(chat.locator('#sent')).toHaveText('4', { timeout: 20000 });
    await expect(
      panel.getByRole('button', { name: 'Sent to WhatsApp', exact: true }),
    ).toBeDisabled();
    expect(
      inputs.filter((entry) => entry.input !== 'Check connection.'),
    ).toHaveLength(6);
    expect(inputs.at(-1)?.apiKey).toBe('fixture-provider-key-not-real');
    await panel.screenshot({
      path: 'artifacts/whatsapp-ai/reply-after-backend-restart.png',
      fullPage: true,
    });
    await chat
      .getByRole('button', { name: 'Duplicate last incoming node' })
      .click();
    await chat.getByRole('button', { name: 'Add outgoing message' }).click();
    await chat.getByRole('button', { name: 'Prepend older history' }).click();
    await expect(chat.locator('#sent')).toHaveText('4');

    await panel
      .getByRole('button', { name: 'Pause auto-reply for this chat' })
      .click();
    await expect(
      panel.getByText('Auto-reply paused for this chat', { exact: true }),
    ).toBeVisible();
    await chat.bringToFront();
    await chat
      .getByRole('button', { name: 'Receive incoming message', exact: true })
      .click();
    await expect(
      panel.getByRole('button', { name: 'Generate manual draft', exact: true }),
    ).toBeEnabled();
    expect(
      inputs.filter((entry) => entry.input !== 'Check connection.'),
    ).toHaveLength(6);
    await expect(chat.locator('#sent')).toHaveText('4');
    await panel
      .getByRole('button', { name: 'Resume auto-reply for this chat' })
      .click();
    await expect(panel.getByText(/Auto-reply active/)).toBeVisible();
    // Resuming does not replay the message received while paused.
    await expect(chat.locator('#sent')).toHaveText('4');
    await chat.bringToFront();
    await chat.getByRole('button', { name: 'Switch chat' }).click();
    await expect(
      panel.getByRole('heading', { name: 'Fixture customer D', exact: true }),
    ).toBeVisible();
    await expect(panel.getByText('Chat ready', { exact: true })).toBeVisible();
    await chat
      .getByRole('textbox', { name: 'Message composer' })
      .fill('My existing manual draft');
    await chat
      .getByRole('button', { name: 'Receive incoming message', exact: true })
      .click();
    await expect(
      panel.getByText(/The composer already contains text or was edited/),
    ).toBeVisible();
    await expect(
      chat.getByRole('textbox', { name: 'Message composer' }),
    ).toHaveText('My existing manual draft');
    await expect(chat.locator('#sent')).toHaveText('4');
    expect(
      inputs.filter((entry) => entry.input !== 'Check connection.'),
    ).toHaveLength(7);
    // Unknown facts receive a fixed fallback automatically, without inserting a
    // provider's unsupported answer or claiming a notification was delivered.
    await chat.getByRole('button', { name: 'Switch chat' }).click();
    await expect(
      panel.getByRole('heading', { name: 'Fixture customer E', exact: true }),
    ).toBeVisible();
    await expect(panel.getByText('Chat ready', { exact: true })).toBeVisible();
    await chat
      .getByRole('textbox', { name: 'Customer message' })
      .fill('Unknown service question');
    await chat
      .getByRole('button', { name: 'Receive incoming message', exact: true })
      .click();
    await expect(chat.locator('#sent')).toHaveText('5');
    await expect(
      panel.getByRole('heading', {
        name: 'Standard fallback reply',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      panel.getByRole('textbox', { name: /^Live suggested reply/ }),
    ).toHaveValue(/confirmed information.*speak with our team/);
    await panel.screenshot({
      path: 'artifacts/whatsapp-ai/automatic-fallback.png',
      fullPage: true,
    });

    // Real trusted editing cancels this transaction even if the visible draft
    // is later restored to the same words before Send becomes available.
    await chat.getByRole('button', { name: 'Switch chat' }).click();
    await expect(
      panel.getByRole('heading', { name: 'Fixture customer F', exact: true }),
    ).toBeVisible();
    await expect(panel.getByText('Chat ready', { exact: true })).toBeVisible();
    await chat
      .getByRole('checkbox', { name: 'Delay fixture Send button' })
      .check();
    await chat
      .getByRole('textbox', { name: 'Customer message' })
      .fill('Normal new service question');
    await chat
      .getByRole('button', { name: 'Receive incoming message', exact: true })
      .click();
    await expect(
      chat.getByRole('textbox', { name: 'Message composer' }),
    ).toHaveText(/₹650\sfor\s500\sgrams/);
    await chat
      .getByRole('textbox', { name: 'Message composer' })
      .fill('Operator editing this reply');
    await chat
      .getByRole('textbox', { name: 'Message composer' })
      .fill(
        'Chocolate Truffle Cake costs ₹650 for 500 grams. Eggless is available.',
      );
    await chat
      .getByRole('checkbox', { name: 'Delay fixture Send button' })
      .uncheck();
    await expect(
      panel.getByText(/The composer already contains text or was edited/),
    ).toBeVisible();
    await expect(chat.locator('#sent')).toHaveText('5');
    await chat.getByRole('button', { name: 'Switch chat' }).click();
    await expect(
      panel.getByRole('heading', { name: 'Fixture customer G', exact: true }),
    ).toBeVisible();
    await expect(panel.getByText('Chat ready', { exact: true })).toBeVisible();
    await chat
      .getByRole('textbox', { name: 'Customer message' })
      .fill('Multiline service question');
    await chat
      .getByRole('button', { name: 'Receive incoming message', exact: true })
      .click();
    await expect(chat.locator('#sent')).toHaveText('6');
    await expect(
      panel.getByRole('textbox', { name: /^Live suggested reply/ }),
    ).toHaveValue(
      'Hello! 👋\n\nChocolate Truffle Cake costs ₹650 for 500 grams.\nEggless is available.',
    );
    await options.setViewportSize({ width: 360, height: 950 });
    await expect
      .poll(() =>
        options.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      )
      .toBe(true);
    await options.screenshot({
      path: 'artifacts/whatsapp-ai/auto-reply-settings-mobile.png',
      fullPage: true,
    });
    const autoStorage = await options.evaluate(async () =>
      JSON.stringify(await chrome.storage.local.get(null)),
    );
    expect(autoStorage).toContain('SENT');
    expect(autoStorage).not.toContain(
      'What is the price of Chocolate Truffle Cake?',
    );
    const deliveries = await options.evaluate(async () =>
      JSON.stringify(
        await chrome.storage.local.get('assistant.webDelivery.v1'),
      ),
    );
    expect(deliveries).not.toContain('Chocolate Truffle Cake costs');
  } finally {
    await context.close();
    await backend.close();
    fixture.closeAllConnections();
    await new Promise<void>((accept) => fixture.close(() => accept()));
    await rm(connectionDirectory, { recursive: true, force: true });
  }
});
