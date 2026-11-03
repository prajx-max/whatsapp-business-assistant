import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveController } from '../src/background/live-controller.js';
import { BackendClient } from '../src/background/backend-client.js';
import { createHarness } from './helpers.js';
import { AutoSendCommandSchema } from '@assistant/contracts';
import type { AdapterContext, AdapterStatus } from '@assistant/contracts';
import { digest, DELIVERY_KEY } from '../src/background/delivery-journal.js';
import { safeFallback } from '@assistant/core';

const context: AdapterContext = {
  profileId: 'sweet-crumbs-demo',
  contextId: 'fixture-context',
  chatKey: 'a'.repeat(64),
  chatLabel: 'Fixture customer',
};
const status: AdapterStatus = {
  ready: true,
  context,
  matches: {
    appShell: 0,
    chatHeader: 0,
    messageList: 0,
    incomingMessage: 0,
    outgoingMessage: -1,
    messageText: 0,
    composer: 0,
    sendButton: 0,
  },
};
async function setup(delayed?: Promise<Response>, automatic = false) {
  const harness = createHarness();
  if (automatic)
    await harness.repository.update((settings) => ({
      ...settings,
      profiles: settings.profiles.map((profile) => ({
        ...profile,
        replyMode: 'AUTO_REPLY_WEB',
        webAutoSendOptIn: true,
      })),
    }));
  const calls: string[] = [];
  const synced: unknown[] = [];
  const output = { needsHuman: false };
  const requests: { requestId: string; text: string }[] = [];
  let firstPending = delayed;
  const backend = new BackendClient(async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/api/status'))
      return Response.json({
        configured: true,
        provider: 'openai',
        model: 'fixture-model',
      });
    if (url.endsWith('/api/profiles')) {
      synced.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true });
    }
    const request = JSON.parse(String(init?.body)) as {
      requestId: string;
      text: string;
    };
    requests.push(request);
    if (firstPending) {
      const response = firstPending;
      firstPending = undefined;
      return response;
    }
    return Response.json({
      requestId: request.requestId,
      reply: 'A verified fixture reply.',
      needsHuman: output.needsHuman,
      grounded: true,
      provider: 'openai',
      model: 'fixture-model',
    });
  });
  const isActive = vi.fn().mockResolvedValue(true);
  const reconnect = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn<(tabId: number, message: unknown) => Promise<unknown>>(
    async (tabId, message) => {
      const command = AutoSendCommandSchema.safeParse(message);
      if (!command.success) return { ok: true };
      const authorization = await controller.handle(
        {
          type: 'ADAPTER_AUTHORIZE_SEND',
          version: 1,
          context: command.data.context,
          sourceEventKey: command.data.sourceEventKey,
          deliveryId: command.data.deliveryId,
          replyHash: await digest(command.data.text),
        },
        tabId,
      );
      expect(authorization).toEqual({ ok: true });
      return { state: 'SENT', reason: 'ACCEPTED_BY_WHATSAPP' };
    },
  );
  const controller = new LiveController(
    harness.repository,
    harness.local,
    { send, isActive, reconnect, notify: vi.fn() },
    backend,
  );
  await controller.connect('fixture-pairing-code', true);
  await controller.handle({ type: 'ADAPTER_STATUS', version: 1, status }, 1);
  return {
    ...harness,
    controller,
    calls,
    send,
    isActive,
    synced,
    output,
    backend,
    requests,
  };
}

afterEach(() => vi.restoreAllMocks());

const incoming = (eventKey = 'e'.repeat(64)) =>
  ({
    type: 'ADAPTER_MESSAGE',
    version: 1,
    context,
    eventKey,
    text: 'A fresh question',
  }) as const;
async function delivery(
  harness: Awaited<ReturnType<typeof setup>>,
  state: string,
) {
  await vi.waitFor(async () =>
    expect(
      harness.controller.snapshot(await harness.repository.load()).live
        ?.suggestion?.delivery?.state,
    ).toBe(state),
  );
}
describe('cooldown continuation and cancellation', () => {
  const baseTime = 1800000000000;
  async function queued() {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    const harness = await setup(undefined, true);
    await harness.controller.handle(incoming(), 1);
    await delivery(harness, 'SENT');
    clock.mockReturnValue(baseTime + 100);
    const ack = await harness.controller.handle(
      { ...incoming('f'.repeat(64)), text: 'Second question' },
      1,
    );
    expect(ack).toEqual({ ok: true, pollAfterMs: 1000 });
    expect(
      harness.controller.snapshot(await harness.repository.load()).live
        ?.suggestion?.state,
    ).toBe('WAITING');
    return { ...harness, clock };
  }
  it('waits for the persisted send cooldown and coalesces a burst into its latest message', async () => {
    const harness = await queued();
    harness.clock.mockReturnValue(baseTime + 3000);
    await harness.controller.handle(
      { ...incoming('d'.repeat(64)), text: 'Newest question in burst' },
      1,
    );
    await harness.controller.handle(
      { type: 'ADAPTER_POLL', version: 1, context },
      1,
    );
    expect(harness.requests).toHaveLength(1);
    const duplicate = await harness.controller.handle(
      incoming('d'.repeat(64)),
      1,
    );
    expect(duplicate).toEqual({ ok: true, pollAfterMs: 1000 });
    harness.clock.mockReturnValue(baseTime + 10001);
    await harness.controller.handle(
      { type: 'ADAPTER_POLL', version: 1, context },
      1,
    );
    await delivery(harness, 'SENT');
    expect(harness.requests.map((request) => request.text)).toEqual([
      'A fresh question',
      'Newest question in burst',
    ]);
    expect(harness.send).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(harness.local.values)).not.toContain(
      'Newest question in burst',
    );
  });
  it('coalesces an in-flight request without adding a delay when cooldown is zero', async () => {
    let finish: (value: Response) => void = () => undefined;
    const delayed = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const harness = await setup(delayed, true);
    await harness.repository.update((settings) => ({
      ...settings,
      profiles: settings.profiles.map((profile) => ({
        ...profile,
        behavior: { ...profile.behavior, perChatCooldownSeconds: 0 },
      })),
    }));
    await harness.controller.handle(
      { ...incoming(), text: 'First zero-cooldown question' },
      1,
    );
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
    await harness.controller.handle(
      { ...incoming('f'.repeat(64)), text: 'Latest zero-cooldown question' },
      1,
    );
    expect(harness.requests).toHaveLength(1);
    finish(
      Response.json({
        requestId: harness.requests[0]?.requestId,
        reply: 'Obsolete answer',
        needsHuman: false,
        grounded: true,
        provider: 'openai',
        model: 'fixture-model',
      }),
    );
    await delivery(harness, 'SENT');
    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[1]?.text).toBe('Latest zero-cooldown question');
    expect(harness.send).toHaveBeenCalledTimes(1);
  });
  it.each([
    'pause',
    'disabled',
    'chat-switch',
    'tab-close',
    'reset',
    'reconnect',
  ] as const)('cancels queued automatic work on %s', async (reason) => {
    const harness = await queued();
    if (reason === 'pause') await harness.controller.setTakeover(context, true);
    if (reason === 'disabled')
      await harness.repository.update((settings) => ({
        ...settings,
        enabled: false,
      }));
    if (reason === 'chat-switch')
      await harness.controller.handle(
        {
          type: 'ADAPTER_STATUS',
          version: 1,
          status: {
            ...status,
            context: {
              ...context,
              contextId: 'different-chat',
              chatKey: 'b'.repeat(64),
            },
          },
        },
        1,
      );
    if (reason === 'tab-close') harness.controller.forget(1);
    if (reason === 'reset') await harness.controller.reset();
    if (reason === 'reconnect') await harness.controller.reconnect();
    harness.clock.mockReturnValue(baseTime + 11000);
    await harness.controller.handle(
      { type: 'ADAPTER_POLL', version: 1, context },
      1,
    );
    expect(harness.requests).toHaveLength(1);
    expect(
      harness.controller.snapshot(await harness.repository.load()).live
        ?.suggestion?.state,
    ).not.toBe('WAITING');
    if (reason === 'pause') {
      await harness.controller.setTakeover(context, false);
      expect(
        await harness.controller.handle(
          { type: 'ADAPTER_POLL', version: 1, context },
          1,
        ),
      ).toEqual({ ok: false });
      expect(harness.requests).toHaveLength(1);
    }
  });
  it('expires queued messages and allows only a manual draft afterward', async () => {
    const harness = await queued();
    harness.clock.mockReturnValue(baseTime + 121000);
    await harness.controller.handle(
      { type: 'ADAPTER_POLL', version: 1, context },
      1,
    );
    expect(
      harness.controller.snapshot(await harness.repository.load()).live
        ?.suggestion?.error,
    ).toBe('MESSAGE_EXPIRED');
    await harness.controller.retry();
    await vi.waitFor(async () =>
      expect(
        harness.controller.snapshot(await harness.repository.load()).live
          ?.suggestion?.state,
      ).toBe('READY'),
    );
    expect(harness.send).toHaveBeenCalledTimes(1);
  });
  it('reports an overlong interval without leaving work queued indefinitely', async () => {
    const harness = await setup(undefined, true);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    await harness.repository.update((settings) => ({
      ...settings,
      profiles: settings.profiles.map((profile) => ({
        ...profile,
        behavior: { ...profile.behavior, perChatCooldownSeconds: 3600 },
      })),
    }));
    await harness.controller.handle(incoming(), 1);
    await delivery(harness, 'SENT');
    clock.mockReturnValue(baseTime + 100);
    await harness.controller.handle(incoming('f'.repeat(64)), 1);
    expect(
      harness.controller.snapshot(await harness.repository.load()).live
        ?.suggestion?.error,
    ).toBe('COOLDOWN_TOO_LONG');
    expect(harness.requests).toHaveLength(1);
  });
  it('validates polling ownership and drops pending raw text after worker recreation', async () => {
    const harness = await queued();
    for (const bad of [
      { ...context, profileId: 'other-business' },
      { ...context, chatKey: 'c'.repeat(64) },
      { ...context, contextId: 'different-context' },
    ])
      expect(
        await harness.controller.handle(
          { type: 'ADAPTER_POLL', version: 1, context: bad },
          1,
        ),
      ).toEqual({ ok: false });
    expect(
      await harness.controller.handle(
        { type: 'ADAPTER_POLL', version: 1, context },
        2,
      ),
    ).toEqual({ ok: false });
    const send = vi
      .fn()
      .mockResolvedValue({ state: 'SENT', reason: 'ACCEPTED_BY_WHATSAPP' });
    const restarted = new LiveController(
      harness.repository,
      harness.local,
      { send, isActive: harness.isActive, notify: vi.fn() },
      harness.backend,
    );
    await restarted.handle({ type: 'ADAPTER_STATUS', version: 1, status }, 1);
    expect(
      await restarted.handle({ type: 'ADAPTER_POLL', version: 1, context }, 1),
    ).toEqual({ ok: false });
    await restarted.handle(incoming('f'.repeat(64)), 1);
    expect(
      restarted.snapshot(await harness.repository.load()).live?.message,
    ).toBeNull();
    // A fresh event after restart still honors the journal's send cooldown.
    await restarted.handle(incoming('d'.repeat(64)), 1);
    expect(
      restarted.snapshot(await harness.repository.load()).live?.suggestion
        ?.state,
    ).toBe('WAITING');
    expect(harness.requests).toHaveLength(1);
    harness.clock.mockReturnValue(baseTime + 10001);
    await restarted.handle({ type: 'ADAPTER_POLL', version: 1, context }, 1);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(harness.requests).toHaveLength(2);
  });
});

describe('opt-in web automatic replies', () => {
  it('automatically sends only a worker-defined fallback when confirmed information is missing', async () => {
    const harness = await setup(undefined, true);
    harness.output.needsHuman = true;
    await harness.controller.handle(incoming(), 1);
    await delivery(harness, 'SENT');
    const suggestion = harness.controller.snapshot(
      await harness.repository.load(),
    ).live?.suggestion;
    expect(suggestion).toMatchObject({
      needsHuman: true,
      standardFallback: true,
      reply: safeFallback('en'),
    });
    expect(harness.send.mock.calls[0]?.[1]).toMatchObject({
      text: safeFallback('en'),
    });
    expect(harness.send.mock.calls[0]?.[1]).not.toMatchObject({
      text: 'A verified fixture reply.',
    });
  });
  it('keeps manual generation as a draft even for an unsupported question in Auto-reply mode', async () => {
    const harness = await setup(undefined, true);
    harness.output.needsHuman = true;
    await harness.controller.setTakeover(context, true);
    await harness.controller.handle(incoming(), 1);
    await harness.controller.retry();
    await vi.waitFor(async () =>
      expect(
        harness.controller.snapshot(await harness.repository.load()).live
          ?.suggestion?.state,
      ).toBe('READY'),
    );
    expect(harness.send).not.toHaveBeenCalled();
    expect(
      harness.controller.snapshot(await harness.repository.load()).live
        ?.suggestion?.standardFallback,
    ).toBe(false);
  });
  it('queues the latest message instead of losing both replies during cooldown', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1800000000000);
    let finish: (value: Response) => void = () => undefined;
    const delayed = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const harness = await setup(delayed, true);
    await harness.controller.handle(
      { ...incoming(), text: 'First question' },
      1,
    );
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
    await harness.controller.handle(
      { ...incoming('f'.repeat(64)), text: 'Latest question' },
      1,
    );
    expect(
      harness.controller.snapshot(await harness.repository.load()).live
        ?.suggestion?.state,
    ).toBe('WAITING');
    finish(
      Response.json({
        requestId: harness.requests[0]?.requestId,
        reply: 'Obsolete answer',
        needsHuman: false,
        grounded: true,
        provider: 'openai',
        model: 'fixture-model',
      }),
    );
    now.mockReturnValue(1800000010001);
    await harness.controller.handle(
      { type: 'ADAPTER_POLL', version: 1, context },
      1,
    );
    await delivery(harness, 'SENT');
    expect(harness.requests.map((request) => request.text)).toEqual([
      'First question',
      'Latest question',
    ]);
    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(harness.send.mock.calls[0]?.[1]).toMatchObject({
      sourceEventKey: 'f'.repeat(64),
      text: 'A verified fixture reply.',
    });
  });
  it('sends a fresh eligible reply once, retaining only hashes and projecting backend draft policy', async () => {
    const harness = await setup(undefined, true);
    await harness.controller.handle(incoming(), 1);
    await delivery(harness, 'SENT');
    await harness.controller.handle(incoming(), 1);
    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(harness.synced).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profile: expect.objectContaining({ replyMode: 'DRAFT_ONLY' }),
        }),
      ]),
    );
    expect(JSON.stringify(harness.synced)).not.toContain('webAutoSendOptIn');
    const persisted = JSON.stringify(harness.local.values);
    expect(persisted).toContain('SENT');
    expect(persisted).not.toContain('A fresh question');
    expect(persisted).not.toContain('A verified fixture reply.');
  });
  it('never sends in Draft only mode', async () => {
    const harness = await setup();
    await harness.controller.handle(incoming(), 1);
    await vi.waitFor(async () =>
      expect(
        harness.controller.snapshot(await harness.repository.load()).live
          ?.suggestion?.state,
      ).toBe('READY'),
    );
    expect(harness.send).not.toHaveBeenCalled();
  });
  it.each(['inactive', 'outside-hours'] as const)(
    'keeps a draft when %s blocks sending',
    async (reason) => {
      const harness = await setup(undefined, true);
      if (reason === 'inactive') harness.isActive.mockResolvedValue(false);
      if (reason === 'outside-hours')
        await harness.repository.update((settings) => ({
          ...settings,
          profiles: settings.profiles.map((profile) => ({
            ...profile,
            workingHours: {
              description: 'Closed',
              outsideHoursAction: 'DRAFT',
              schedule: [{ day: 0, opens: '00:00', closes: '00:00' }],
            },
          })),
        }));
      await harness.controller.handle(incoming(), 1);
      await delivery(harness, 'BLOCKED');
      expect(harness.send).not.toHaveBeenCalled();
    },
  );
  it('persists chat takeover, blocks generation until explicit release, and keeps manual generation draft-only', async () => {
    const harness = await setup(undefined, true);
    await harness.controller.setTakeover(context, true);
    await harness.controller.handle(incoming(), 1);
    expect(
      harness.calls.filter((url) => url.endsWith('/api/assist')),
    ).toHaveLength(0);
    expect(
      (await harness.repository.load()).takeovers[context.chatKey]?.profileId,
    ).toBe(context.profileId);
    const restarted = new LiveController(
      harness.repository,
      harness.local,
      { send: harness.send, isActive: harness.isActive, notify: vi.fn() },
      harness.backend,
    );
    await restarted.handle({ type: 'ADAPTER_STATUS', version: 1, status }, 1);
    await restarted.handle(incoming('d'.repeat(64)), 1);
    expect(
      harness.calls.filter((url) => url.endsWith('/api/assist')),
    ).toHaveLength(0);
    await expect(
      harness.controller.setTakeover(
        { ...context, profileId: 'other-business' },
        false,
      ),
    ).rejects.toThrow('STALE_DRAFT');
    await harness.controller.retry();
    await vi.waitFor(async () =>
      expect(
        harness.controller.snapshot(await harness.repository.load()).live
          ?.suggestion?.state,
      ).toBe('READY'),
    );
    expect(harness.send).not.toHaveBeenCalled();
    await harness.controller.setTakeover(context, false);
    expect(
      (await harness.repository.load()).takeovers[context.chatKey],
    ).toBeUndefined();
    await harness.controller.handle(incoming('f'.repeat(64)), 1);
    await delivery(harness, 'SENT');
  });
  it('denies content-script requests without a matching worker-owned pending send, tab, hash and scope', async () => {
    const harness = await setup(undefined, true);
    const command = {
      type: 'ADAPTER_AUTHORIZE_SEND',
      version: 1,
      context,
      sourceEventKey: 'e'.repeat(64),
      deliveryId: crypto.randomUUID(),
      replyHash: 'f'.repeat(64),
    } as const;
    expect(await harness.controller.handle(command, 1)).toEqual({ ok: false });
    harness.send.mockImplementation(async (tabId, raw) => {
      const parsed = AutoSendCommandSchema.parse(raw);
      const request = {
        ...command,
        context: parsed.context,
        sourceEventKey: parsed.sourceEventKey,
        deliveryId: parsed.deliveryId,
        replyHash: await digest(parsed.text),
      };
      expect(await harness.controller.handle(request, tabId + 1)).toEqual({
        ok: false,
      });
      expect(
        await harness.controller.handle(
          { ...request, replyHash: '0'.repeat(64) },
          tabId,
        ),
      ).toEqual({ ok: false });
      expect(
        await harness.controller.handle(
          { ...request, context: { ...context, profileId: 'wrong-profile' } },
          tabId,
        ),
      ).toEqual({ ok: false });
      await harness.controller.setTakeover(context, true);
      expect(await harness.controller.handle(request, tabId)).toEqual({
        ok: false,
      });
      return { state: 'BLOCKED', reason: 'AUTHORIZATION_REVOKED' };
    });
    await harness.controller.handle(incoming(), 1);
    await delivery(harness, 'BLOCKED');
  });
  it('will not send if durable reservation fails', async () => {
    const harness = await setup(undefined, true);
    const original = harness.local.set.bind(harness.local);
    vi.spyOn(harness.local, 'set').mockImplementation(async (values) => {
      if (DELIVERY_KEY in values) throw new Error('Storage unavailable');
      await original(values);
    });
    await harness.controller.handle(incoming(), 1);
    await delivery(harness, 'BLOCKED');
    expect(harness.send).not.toHaveBeenCalled();
  });
  it('rechecks a pause saved while the final active-tab query is pending', async () => {
    const harness = await setup(undefined, true);
    let authorized: unknown;
    harness.send.mockImplementation(async (tabId, raw) => {
      const command = AutoSendCommandSchema.parse(raw);
      let entered = false;
      let release: (active: boolean) => void = () => undefined;
      const active = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      harness.isActive.mockImplementationOnce(() => {
        entered = true;
        return active;
      });
      const checking = harness.controller.handle(
        {
          type: 'ADAPTER_AUTHORIZE_SEND',
          version: 1,
          context: command.context,
          deliveryId: command.deliveryId,
          sourceEventKey: command.sourceEventKey,
          replyHash: await digest(command.text),
        },
        tabId,
      );
      await vi.waitFor(() => expect(entered).toBe(true));
      await harness.controller.setTakeover(context, true);
      release(true);
      authorized = await checking;
      return { state: 'BLOCKED', reason: 'AUTHORIZATION_REVOKED' };
    });
    await harness.controller.handle(incoming(), 1);
    await delivery(harness, 'BLOCKED');
    expect(authorized).toEqual({ ok: false });
  });
  it('never replays an uncertain delivery after restart or a manual retry', async () => {
    const harness = await setup(undefined, true);
    harness.send.mockRejectedValue(new Error('Acknowledgement lost'));
    await harness.controller.handle(incoming(), 1);
    await delivery(harness, 'UNCERTAIN');
    await expect(harness.controller.retry()).rejects.toThrow('STALE_DRAFT');
    const restarted = new LiveController(
      harness.repository,
      harness.local,
      { send: harness.send, isActive: harness.isActive, notify: vi.fn() },
      harness.backend,
    );
    await restarted.handle({ type: 'ADAPTER_STATUS', version: 1, status }, 1);
    await restarted.handle(incoming(), 1);
    expect(harness.send).toHaveBeenCalledTimes(1);
  });
  it('drops automatic sending when settings change during generation', async () => {
    let finish: (response: Response) => void = () => undefined;
    const response = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const harness = await setup(response, true);
    await harness.controller.handle(incoming(), 1);
    await vi.waitFor(() =>
      expect(harness.calls.some((url) => url.endsWith('/api/assist'))).toBe(
        true,
      ),
    );
    const id = harness.controller.snapshot(await harness.repository.load()).live
      ?.suggestion?.id;
    await harness.repository.update((settings) => ({
      ...settings,
      enabled: false,
    }));
    finish(
      Response.json({
        requestId: id,
        reply: 'A verified fixture reply.',
        needsHuman: false,
        grounded: true,
        provider: 'openai',
        model: 'fixture-model',
      }),
    );
    await vi.waitFor(async () =>
      expect(
        harness.controller.snapshot(await harness.repository.load()).live
          ?.suggestion?.state,
      ).toBe('ERROR'),
    );
    expect(harness.send).not.toHaveBeenCalled();
  });
});
describe('live message ownership and stale result handling', () => {
  it('exposes missing-selector diagnostics even before chat identity exists', async () => {
    const { controller, repository } = await setup();
    const waiting = {
      ...status,
      ready: false,
      context: null,
      matches: { ...status.matches, messageList: -1 },
    };
    await controller.handle(
      { type: 'ADAPTER_STATUS', version: 1, status: waiting },
      1,
    );
    controller.selectTab(1);
    const state = controller.snapshot(await repository.load());
    expect(state.live?.status).toEqual(waiting);
    expect(state.live?.message).toBeNull();
    expect(state.live?.suggestion).toBeNull();
  });
  it('keeps a pending reply through diagnostics-only updates in the same chat', async () => {
    let finish: (value: Response) => void = () => undefined;
    const delayed = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const { controller, repository, calls } = await setup(delayed);
    await controller.handle(
      {
        type: 'ADAPTER_MESSAGE',
        version: 1,
        context,
        eventKey: 'd'.repeat(64),
        text: 'A new message',
      },
      1,
    );
    await vi.waitFor(() =>
      expect(calls.some((url) => url.endsWith('/api/assist'))).toBe(true),
    );
    const id = controller.snapshot(await repository.load()).live?.suggestion
      ?.id;
    await controller.handle(
      {
        type: 'ADAPTER_STATUS',
        version: 1,
        status: {
          ...status,
          matches: { ...status.matches, outgoingMessage: 0 },
        },
      },
      1,
    );
    finish(
      Response.json({
        requestId: id,
        reply: 'Confirmed reply',
        needsHuman: false,
        grounded: true,
        provider: 'openai',
        model: 'fixture-model',
      }),
    );
    await vi.waitFor(async () =>
      expect(
        controller.snapshot(await repository.load()).live?.suggestion?.state,
      ).toBe('READY'),
    );
  });
  it('generates a scoped suggestion without putting customer text into storage', async () => {
    const { controller, repository, local } = await setup();
    await controller.handle(
      {
        type: 'ADAPTER_MESSAGE',
        version: 1,
        context,
        eventKey: 'b'.repeat(64),
        text: 'private-customer-text',
      },
      1,
    );
    await vi.waitFor(async () =>
      expect(
        controller.snapshot(await repository.load()).live?.suggestion?.state,
      ).toBe('READY'),
    );
    expect(JSON.stringify(local.values)).not.toContain('private-customer-text');
    expect(JSON.stringify(local.values)).not.toContain(
      'A verified fixture reply.',
    );
  });
  it('deduplicates across worker/controller recreation', async () => {
    const { controller, repository, local, calls } = await setup();
    const input = {
      type: 'ADAPTER_MESSAGE',
      version: 1,
      context,
      eventKey: 'b'.repeat(64),
      text: 'private',
    } as const;
    await controller.handle(input, 1);
    await vi.waitFor(() =>
      expect(calls.some((url) => url.endsWith('/api/assist'))).toBe(true),
    );
    const restarted = new LiveController(
      repository,
      local,
      { send: vi.fn(), notify: vi.fn() },
      new BackendClient(vi.fn()),
    );
    await restarted.handle({ type: 'ADAPTER_STATUS', version: 1, status }, 1);
    await restarted.handle(input, 1);
    expect(
      restarted.snapshot(await repository.load()).live?.message,
    ).toBeNull();
  });
  it('drops a late response after a chat change', async () => {
    let finish: (value: Response) => void = () => undefined;
    const delayed = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const { controller, calls, repository } = await setup(delayed);
    await controller.handle(
      {
        type: 'ADAPTER_MESSAGE',
        version: 1,
        context,
        eventKey: 'b'.repeat(64),
        text: 'private',
      },
      1,
    );
    await vi.waitFor(() =>
      expect(calls.some((url) => url.endsWith('/api/assist'))).toBe(true),
    );
    await controller.handle(
      {
        type: 'ADAPTER_STATUS',
        version: 1,
        status: {
          ...status,
          context: {
            ...context,
            contextId: 'new-chat',
            chatKey: 'c'.repeat(64),
          },
        },
      },
      1,
    );
    finish(
      Response.json({
        requestId: 'stale',
        reply: 'Wrong chat reply',
        needsHuman: false,
        grounded: true,
        provider: 'openai',
        model: 'fixture-model',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      controller.snapshot(await repository.load()).live?.suggestion,
    ).toBeNull();
  });
  it('blocks disabled profiles and stale draft insertion', async () => {
    const { controller, repository, calls, send } = await setup();
    await repository.update((settings) => ({ ...settings, enabled: false }));
    await controller.handle(
      {
        type: 'ADAPTER_MESSAGE',
        version: 1,
        context,
        eventKey: 'b'.repeat(64),
        text: 'private',
      },
      1,
    );
    expect(calls.filter((url) => url.endsWith('/api/assist'))).toHaveLength(0);
    await expect(controller.insert('wrong-draft', 'No')).rejects.toThrow(
      'STALE_DRAFT',
    );
    expect(send).not.toHaveBeenCalled();
  });
  it('stores opt-in separately and disconnects without keeping raw messages', async () => {
    const { controller, repository } = await setup();
    await controller.disconnect();
    const settings = await repository.load();
    expect(settings.connections[settings.activeProfileId]).toEqual({
      token: '',
      autoSuggest: false,
    });
    expect(controller.snapshot(settings).live).toBeNull();
  });
});
