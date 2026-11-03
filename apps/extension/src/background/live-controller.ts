import { z } from 'zod';
import {
  AdapterConfigSchema,
  AutoSendResultSchema,
} from '@assistant/contracts';
import type {
  AdapterRequest,
  LiveState,
  ProviderStatus,
  AdapterContext,
  AutoSendResult,
  BusinessProfile,
} from '@assistant/contracts';
import type {
  StorageArea,
  SettingsRepository,
} from '../storage/settings-repository.js';
import type { Settings } from '../messaging/contracts.js';
import { BackendClient, BackendFailure } from './backend-client.js';
import { DeliveryJournal, digest } from './delivery-journal.js';
import { permitsDraftNow, safeFallback, detectLanguage } from '@assistant/core';

export interface LiveTransport {
  send(tabId: number, message: unknown): Promise<unknown>;
  notify(): void;
  reconnect?(): Promise<void>;
  isActive?(tabId: number): Promise<boolean>;
}
export class LiveFailure extends Error {
  constructor(
    readonly code:
      | 'BACKEND_ERROR'
      | 'STALE_DRAFT'
      | 'COMPOSER_BUSY'
      | 'WHATSAPP_UNAVAILABLE',
  ) {
    super(code);
  }
}
const dedupSchema = z.record(
  z.string().regex(/^[a-f0-9]{64}$/),
  z.number().nonnegative(),
);
interface PendingAutomatic {
  state: LiveState;
  context: AdapterContext;
  revision: number;
  eventKey: string;
  suggestionId: string;
}
const chatScope = (context: AdapterContext) =>
  `${context.profileId}:${context.chatKey}`;
export class LiveController {
  private readonly tabs = new Map<number, LiveState>();
  private readonly metadata = new Map<
    string,
    ProviderStatus & { paired: boolean; error: string }
  >();
  private readonly cooldowns = new Map<string, number>();
  private readonly pendingAutomatic = new Map<number, PendingAutomatic>();
  private readonly automaticRuns = new Map<string, symbol>();
  private queue: Promise<unknown> = Promise.resolve();
  private selectedTab: number | null = null;
  private readonly journal: DeliveryJournal;
  private readonly deliveries = new Map<
    string,
    {
      tabId: number;
      context: AdapterContext;
      eventKey: string;
      suggestionId: string;
      replyHash: string;
      revision: number;
    }
  >();
  constructor(
    private readonly repository: SettingsRepository,
    private readonly local: StorageArea,
    private readonly transport: LiveTransport,
    private readonly backend = new BackendClient(),
  ) {
    this.journal = new DeliveryJournal(local);
  }
  snapshot(settings: Settings) {
    const selected =
      this.selectedTab === null ? undefined : this.tabs.get(this.selectedTab);
    const live =
      selected &&
      (selected.status.context === null ||
        selected.status.context.profileId === settings.activeProfileId)
        ? selected
        : ([...this.tabs.values()]
            .reverse()
            .find(
              (entry) =>
                entry.status.context === null ||
                entry.status.context.profileId === settings.activeProfileId,
            ) ?? null);
    return {
      live,
      backend: this.metadata.get(settings.activeProfileId) ?? {
        configured: false,
        provider: null,
        model: '',
        paired: Boolean(settings.connections[settings.activeProfileId]?.token),
        error: '',
      },
    };
  }
  forget(tabId: number) {
    this.cancelAutomatic(tabId);
    this.tabs.delete(tabId);
    this.transport.notify();
  }
  selectTab(tabId: number) {
    if (this.tabs.has(tabId)) {
      this.selectedTab = tabId;
      this.transport.notify();
    }
  }
  async bootstrap() {
    const settings = await this.repository.load();
    const profile = settings.profiles.find(
      (item) => item.id === settings.activeProfileId,
    );
    if (!profile) throw new Error('Missing profile');
    const saved = await this.local.get('assistant.hashSalt.v1');
    const salt =
      typeof saved['assistant.hashSalt.v1'] === 'string'
        ? saved['assistant.hashSalt.v1']
        : crypto.randomUUID();
    if (!saved['assistant.hashSalt.v1'])
      await this.local.set({ 'assistant.hashSalt.v1': salt });
    return AdapterConfigSchema.parse({
      profileId: profile.id,
      enabled: settings.enabled && profile.replyMode !== 'OFF',
      autoSendEnabled:
        settings.enabled &&
        profile.replyMode === 'AUTO_REPLY_WEB' &&
        profile.webAutoSendOptIn,
      salt,
      selectors: settings.selectors,
      duplicateWindowSeconds: profile.behavior.duplicateWindowSeconds,
    });
  }
  handle(request: AdapterRequest, tabId: number) {
    const result = this.queue.then(() => this.process(request, tabId));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async process(
    request: AdapterRequest,
    tabId: number,
  ): Promise<unknown> {
    if (request.type === 'ADAPTER_BOOTSTRAP') return this.bootstrap();
    if (request.type === 'ADAPTER_POLL') {
      const pending = this.pendingAutomatic.get(tabId);
      if (
        !pending ||
        pending.context.profileId !== request.context.profileId ||
        pending.context.chatKey !== request.context.chatKey ||
        pending.context.contextId !== request.context.contextId
      )
        return { ok: false };
      await this.flushAutomatic(tabId);
      return this.automaticAck(tabId);
    }
    if (request.type === 'ADAPTER_AUTHORIZE_SEND') {
      const pending = this.deliveries.get(request.deliveryId);
      if (
        !pending ||
        pending.tabId !== tabId ||
        pending.replyHash !== request.replyHash ||
        pending.eventKey !== request.sourceEventKey ||
        pending.context.profileId !== request.context.profileId ||
        pending.context.chatKey !== request.context.chatKey ||
        pending.context.contextId !== request.context.contextId
      )
        return { ok: false };
      return { ok: await this.canSend(pending) };
    }
    const settings = await this.repository.load();
    const profile = settings.profiles.find(
      (item) => item.id === settings.activeProfileId,
    );
    if (!profile) return { ok: false };
    if (request.type === 'ADAPTER_STATUS') {
      if (
        request.status.context &&
        request.status.context.profileId !== profile.id
      )
        return { ok: false };
      const previous = this.tabs.get(tabId);
      const same =
        previous?.status.context?.contextId ===
          request.status.context?.contextId &&
        previous?.status.context?.chatKey === request.status.context?.chatKey;
      if (!same || !request.status.ready) this.cancelAutomatic(tabId);
      if (this.tabs.size >= 32 && !previous)
        this.forget(this.tabs.keys().next().value ?? -1);
      if (same && previous) previous.status = request.status;
      this.tabs.set(
        tabId,
        same && previous
          ? previous
          : {
              tabId,
              status: request.status,
              message: same ? (previous?.message ?? null) : null,
              suggestion: same ? (previous?.suggestion ?? null) : null,
            },
      );
      this.transport.notify();
      return { ok: true };
    }
    const state = this.tabs.get(tabId);
    if (
      !settings.enabled ||
      profile.replyMode === 'OFF' ||
      !state?.status.ready ||
      state.status.context?.contextId !== request.context.contextId ||
      state.status.context.chatKey !== request.context.chatKey ||
      request.context.profileId !== profile.id
    )
      return { ok: false };
    const stored = dedupSchema.safeParse(
      (await this.local.get('assistant.seen.v1'))['assistant.seen.v1'],
    );
    const now = Date.now();
    const seen = Object.fromEntries(
      Object.entries(stored.success ? stored.data : {})
        .filter(
          ([, time]) =>
            now - time < profile.behavior.duplicateWindowSeconds * 1000,
        )
        .slice(-255),
    );
    if (seen[request.eventKey]) return this.automaticAck(tabId);
    await this.local.set({
      'assistant.seen.v1': { ...seen, [request.eventKey]: now },
    });
    this.cancelAutomatic(tabId);
    state.message = {
      eventKey: request.eventKey,
      text: request.text,
      receivedAt: now,
    };
    state.suggestion = null;
    this.transport.notify();
    if (settings.takeovers[request.context.chatKey]?.profileId === profile.id)
      return { ok: true };
    if (
      !settings.connections[profile.id]?.autoSuggest &&
      profile.replyMode !== 'AUTO_REPLY_WEB'
    )
      return { ok: true };
    const id = crypto.randomUUID();
    state.suggestion = {
      id,
      state: 'WAITING',
      reply: '',
      needsHuman: false,
      provider: '',
      model: '',
      error: '',
    };
    this.pendingAutomatic.set(tabId, {
      state,
      context: request.context,
      revision: settings.revision,
      eventKey: request.eventKey,
      suggestionId: id,
    });
    this.transport.notify();
    await this.flushAutomatic(tabId);
    return this.automaticAck(tabId);
  }
  private automaticAck(tabId: number) {
    return this.pendingAutomatic.has(tabId)
      ? { ok: true, pollAfterMs: 1000 }
      : { ok: true };
  }
  private cancelAutomatic(tabId: number, error?: string) {
    const pending = this.pendingAutomatic.get(tabId);
    this.pendingAutomatic.delete(tabId);
    if (pending && pending.state.suggestion?.id === pending.suggestionId) {
      pending.state.suggestion =
        error && pending.state.suggestion
          ? {
              ...pending.state.suggestion,
              state: 'ERROR',
              needsHuman: true,
              error,
            }
          : null;
      this.transport.notify();
    }
  }
  private async flushAutomatic(tabId: number) {
    const pending = this.pendingAutomatic.get(tabId);
    if (!pending) return;
    const settings = await this.repository.load();
    const profile = settings.profiles.find(
      (item) => item.id === settings.activeProfileId,
    );
    const { state, context } = pending;
    if (this.pendingAutomatic.get(tabId) !== pending) return;
    if (
      !settings.enabled ||
      settings.revision !== pending.revision ||
      !profile ||
      profile.id !== context.profileId ||
      profile.replyMode === 'OFF' ||
      (profile.replyMode !== 'AUTO_REPLY_WEB' &&
        !settings.connections[profile.id]?.autoSuggest) ||
      settings.takeovers[context.chatKey]?.profileId === context.profileId ||
      this.tabs.get(tabId) !== state ||
      !state.status.ready ||
      state.status.context?.contextId !== context.contextId ||
      state.status.context.chatKey !== context.chatKey ||
      state.message?.eventKey !== pending.eventKey ||
      state.suggestion?.id !== pending.suggestionId
    ) {
      this.cancelAutomatic(tabId, 'SETTINGS_CHANGED');
      return;
    }
    const receivedAt = state.message.receivedAt;
    const expiresAt =
      (receivedAt ?? 0) +
      Math.min(profile.behavior.duplicateWindowSeconds, 300) * 1000;
    if (receivedAt === undefined || Date.now() >= expiresAt) {
      this.cancelAutomatic(tabId, 'MESSAGE_EXPIRED');
      return;
    }
    const scope = chatScope(context);
    // Only one automatic request per business/chat; newer text replaces the
    // pending item and invalidates the older response rather than racing it.
    if (this.automaticRuns.has(scope)) return;
    let dueAt = this.cooldowns.has(scope)
      ? (this.cooldowns.get(scope) ?? 0) +
        profile.behavior.perChatCooldownSeconds * 1000
      : 0;
    if (profile.replyMode === 'AUTO_REPLY_WEB') {
      try {
        dueAt = Math.max(
          dueAt,
          await this.journal.cooldownUntil(profile, context.chatKey),
        );
      } catch {
        this.cancelAutomatic(tabId, 'DELIVERY_STORAGE_ERROR');
        return;
      }
    }
    if (dueAt >= expiresAt) {
      this.cancelAutomatic(tabId, 'COOLDOWN_TOO_LONG');
      return;
    }
    if (Date.now() < dueAt) return;
    if (this.pendingAutomatic.get(tabId) !== pending) return;
    this.pendingAutomatic.delete(tabId);
    this.cooldowns.set(scope, Date.now());
    if (this.cooldowns.size > 256)
      this.cooldowns.delete(this.cooldowns.keys().next().value ?? '');
    const run = Symbol();
    this.automaticRuns.set(scope, run);
    void this.generate(state, settings, true)
      .finally(() => {
        if (this.automaticRuns.get(scope) !== run) return;
        this.automaticRuns.delete(scope);
        // Serialized with incoming events and authorization. A later poll also
        // advances pending work, without relying on worker setTimeout survival.
        const next = this.queue.then(async () => {
          for (const [pendingTab, entry] of this.pendingAutomatic)
            if (chatScope(entry.context) === scope)
              await this.flushAutomatic(pendingTab);
        });
        this.queue = next.catch(() => undefined);
      })
      .catch(() => undefined);
  }
  private async generate(
    state: LiveState,
    settings: Settings,
    automatic = false,
  ) {
    const profile = settings.profiles.find(
      (item) => item.id === settings.activeProfileId,
    );
    const context = state.status.context;
    const message = state.message;
    if (!profile || !context || !message) return;
    const id = crypto.randomUUID();
    state.suggestion = {
      id,
      state: 'GENERATING',
      reply: '',
      needsHuman: false,
      provider: '',
      model: '',
      error: '',
    };
    this.transport.notify();
    try {
      const token = settings.connections[profile.id]?.token;
      if (!token) throw new BackendFailure('NOT_CONFIGURED');
      await this.backend.sync(token, profile);
      const status = await this.backend.status(token);
      this.metadata.set(profile.id, { ...status, paired: true, error: '' });
      if (profile.behavior.replyDelayMinSeconds > 5)
        throw new BackendFailure('DELAY_TOO_LONG');
      if (profile.behavior.replyDelayMinSeconds > 0)
        await new Promise<void>((resolve) =>
          setTimeout(
            resolve,
            Math.min(
              profile.behavior.replyDelayMinSeconds,
              profile.behavior.replyDelayMaxSeconds,
            ) * 1000,
          ),
        );
      const beforeRequest = await this.repository.load();
      if (
        beforeRequest.revision !== settings.revision ||
        this.tabs.get(state.tabId) !== state ||
        state.message?.eventKey !== message.eventKey ||
        state.suggestion?.id !== id
      )
        throw new BackendFailure('SETTINGS_CHANGED');
      const response = await this.backend.suggest(token, {
        profileId: profile.id,
        chatKey: context.chatKey,
        requestId: id,
        text: message.text,
      });
      const current = await this.repository.load();
      if (
        this.tabs.get(state.tabId) !== state ||
        state.message?.eventKey !== message.eventKey ||
        state.suggestion?.id !== id ||
        current.revision !== settings.revision ||
        !current.enabled ||
        current.activeProfileId !== profile.id
      ) {
        if (state.suggestion?.id === id)
          state.suggestion = {
            ...state.suggestion,
            state: 'ERROR',
            error: 'SETTINGS_CHANGED',
          };
        this.transport.notify();
        return;
      }
      if (response.requestId !== id) throw new BackendFailure('INVALID_OUTPUT');
      const standardFallback =
        automatic &&
        profile.replyMode === 'AUTO_REPLY_WEB' &&
        response.needsHuman;
      state.suggestion = {
        id,
        state: 'READY',
        reply: standardFallback
          ? safeFallback(detectLanguage(message.text, profile))
          : response.reply,
        needsHuman: response.needsHuman,
        standardFallback,
        provider: response.provider,
        model: response.model,
        error: '',
      };
      if (automatic && profile.replyMode === 'AUTO_REPLY_WEB')
        await this.autoSend(state, settings);
    } catch (error) {
      if (state.suggestion?.id !== id || this.tabs.get(state.tabId) !== state)
        return;
      const code =
        error instanceof BackendFailure
          ? error.message
          : 'PROVIDER_UNAVAILABLE';
      state.suggestion = {
        id,
        state: 'ERROR',
        reply: '',
        needsHuman: true,
        provider: '',
        model: '',
        error: code,
      };
      this.metadata.set(profile.id, {
        configured: false,
        provider: null,
        model: '',
        paired: Boolean(settings.connections[profile.id]?.token),
        error: code,
      });
    }
    this.transport.notify();
  }
  private async canSend(pending: {
    tabId: number;
    context: AdapterContext;
    eventKey: string;
    suggestionId: string;
    revision: number;
  }) {
    // Query focus before the final settings read. A pause saved during this
    // asynchronous Chrome call must revoke authorization before we respond.
    if (!(await this.transport.isActive?.(pending.tabId))) return false;
    const settings = await this.repository.load();
    const profile = settings.profiles.find(
      (item) => item.id === settings.activeProfileId,
    );
    const state = this.tabs.get(pending.tabId);
    return Boolean(
      settings.enabled &&
      settings.revision === pending.revision &&
      profile?.id === pending.context.profileId &&
      profile.replyMode === 'AUTO_REPLY_WEB' &&
      profile.webAutoSendOptIn &&
      permitsDraftNow({
        ...profile,
        workingHours: {
          ...profile.workingHours,
          outsideHoursAction: 'NO_REPLY',
        },
      }) &&
      settings.takeovers[pending.context.chatKey]?.profileId !== profile.id &&
      state?.status.ready &&
      state.status.context?.contextId === pending.context.contextId &&
      state.status.context.chatKey === pending.context.chatKey &&
      state.message?.eventKey === pending.eventKey &&
      state.message.receivedAt !== undefined &&
      Date.now() - state.message.receivedAt <=
        Math.min(profile.behavior.duplicateWindowSeconds, 300) * 1000 &&
      state.suggestion?.id === pending.suggestionId &&
      state.suggestion.state === 'READY' &&
      this.eligibleReply(state, profile),
    );
  }
  private eligibleReply(state: LiveState, profile: BusinessProfile) {
    const suggestion = state.suggestion;
    return Boolean(
      suggestion &&
      (!suggestion.needsHuman ||
        (suggestion.standardFallback &&
          state.message &&
          suggestion.reply ===
            safeFallback(detectLanguage(state.message.text, profile)))),
    );
  }
  private async autoSend(state: LiveState, settings: Settings) {
    const context = state.status.context;
    const message = state.message;
    const suggestion = state.suggestion;
    const profile = settings.profiles.find(
      (item) => item.id === context?.profileId,
    );
    if (!context || !message || !suggestion || !profile) return;
    const block = (reason: string) => {
      suggestion.delivery = { state: 'BLOCKED', reason };
      this.transport.notify();
    };
    const pending = {
      tabId: state.tabId,
      context,
      eventKey: message.eventKey,
      suggestionId: suggestion.id,
      revision: settings.revision,
      replyHash: await digest(suggestion.reply),
    };
    if (!this.eligibleReply(state, profile)) {
      block('HUMAN_REVIEW_REQUIRED');
      return;
    }
    if (!(await this.canSend(pending))) {
      block('INACTIVE_OR_CHANGED_CHAT');
      return;
    }
    let claim: Awaited<ReturnType<DeliveryJournal['claim']>>;
    try {
      claim = await this.journal.claim(
        profile,
        context.chatKey,
        message.eventKey,
      );
    } catch {
      block('DELIVERY_STORAGE_ERROR');
      return;
    }
    if (!claim.ok) {
      block(claim.reason);
      return;
    }
    const deliveryId = crypto.randomUUID();
    this.deliveries.set(deliveryId, pending);
    suggestion.delivery = { state: 'SENDING', reason: '' };
    this.transport.notify();
    let result: AutoSendResult = {
      state: 'UNCERTAIN',
      reason: 'SEND_UNCONFIRMED',
    };
    try {
      const response = await this.transport.send(state.tabId, {
        type: 'SEND_AUTOMATIC_REPLY',
        version: 1,
        context,
        sourceEventKey: message.eventKey,
        deliveryId,
        text: suggestion.reply,
      });
      const parsed = AutoSendResultSchema.safeParse(response);
      if (parsed.success) result = parsed.data;
    } catch {
      /* A lost acknowledgement must never trigger an automatic retry. */
    } finally {
      this.deliveries.delete(deliveryId);
    }
    try {
      await this.journal.finish(claim.key, result.state);
    } catch {
      result = { state: 'UNCERTAIN', reason: 'SEND_UNCONFIRMED' };
    }
    suggestion.delivery = result;
    this.transport.notify();
  }
  async setTakeover(context: AdapterContext, paused: boolean) {
    await this.repository.update((settings) => {
      const current = this.snapshot(settings).live?.status.context;
      if (
        !current ||
        current.contextId !== context.contextId ||
        current.chatKey !== context.chatKey ||
        current.profileId !== context.profileId ||
        settings.activeProfileId !== context.profileId
      )
        throw new LiveFailure('STALE_DRAFT');
      const takeovers = { ...settings.takeovers };
      if (paused)
        takeovers[context.chatKey] = {
          profileId: context.profileId,
          chatKey: context.chatKey,
          pausedAt: Date.now(),
        };
      else {
        if (takeovers[context.chatKey]?.profileId !== context.profileId)
          throw new LiveFailure('STALE_DRAFT');
        delete takeovers[context.chatKey];
      }
      return { ...settings, takeovers };
    });
    if (paused)
      for (const [tabId, pending] of this.pendingAutomatic)
        if (chatScope(pending.context) === chatScope(context))
          this.cancelAutomatic(tabId);
    this.transport.notify();
  }
  async connect(token: string, autoSuggest: boolean) {
    const settings = await this.repository.load();
    const profile = settings.profiles.find(
      (item) => item.id === settings.activeProfileId,
    );
    if (!profile) throw new LiveFailure('BACKEND_ERROR');
    const credential = token || settings.connections[profile.id]?.token || '';
    try {
      const status = await this.backend.status(credential);
      if (!status.configured) throw new BackendFailure('NOT_CONFIGURED');
      await this.backend.sync(credential, profile);
      await this.repository.update((current) => {
        if (
          current.activeProfileId !== profile.id ||
          current.revision !== settings.revision
        )
          throw new LiveFailure('STALE_DRAFT');
        return {
          ...current,
          connections: {
            ...current.connections,
            [profile.id]: { token: credential, autoSuggest },
          },
        };
      });
      this.metadata.set(profile.id, { ...status, paired: true, error: '' });
    } catch (error) {
      this.metadata.set(profile.id, {
        configured: false,
        provider: null,
        model: '',
        paired: false,
        error:
          error instanceof BackendFailure ? error.message : 'BACKEND_ERROR',
      });
      this.transport.notify();
      throw new LiveFailure('BACKEND_ERROR');
    }
    this.transport.notify();
  }
  async disconnect() {
    const settings = await this.repository.load();
    await this.repository.update((current) => ({
      ...current,
      connections: {
        ...current.connections,
        [settings.activeProfileId]: { token: '', autoSuggest: false },
      },
    }));
    this.metadata.delete(settings.activeProfileId);
    await this.reset();
  }
  async reconnect() {
    for (const tabId of this.pendingAutomatic.keys())
      this.cancelAutomatic(tabId);
    try {
      if (!this.transport.reconnect) throw new Error('Unavailable');
      await this.transport.reconnect();
      this.transport.notify();
    } catch {
      throw new LiveFailure('WHATSAPP_UNAVAILABLE');
    }
  }
  async retry() {
    const settings = await this.repository.load();
    const state = this.snapshot(settings).live;
    if (
      !state?.message ||
      (state.suggestion?.delivery !== undefined &&
        state.suggestion.delivery.state !== 'BLOCKED') ||
      !settings.enabled ||
      !settings.profiles.some(
        (profile) =>
          profile.id === settings.activeProfileId &&
          profile.replyMode !== 'OFF',
      )
    )
      throw new LiveFailure('STALE_DRAFT');
    this.cancelAutomatic(state.tabId);
    void this.generate(state, settings).catch(() => undefined);
  }
  async insert(id: string, text: string) {
    const settings = await this.repository.load();
    const state = this.snapshot(settings).live;
    if (
      !settings.enabled ||
      !state?.status.context ||
      (state.suggestion?.delivery &&
        state.suggestion.delivery.state !== 'BLOCKED') ||
      state.suggestion?.id !== id ||
      state.suggestion.state !== 'READY' ||
      !settings.profiles.some(
        (profile) =>
          profile.id === settings.activeProfileId &&
          profile.replyMode !== 'OFF',
      )
    )
      throw new LiveFailure('STALE_DRAFT');
    const result = await this.transport.send(state.tabId, {
      type: 'INSERT_APPROVED_DRAFT',
      version: 1,
      context: state.status.context,
      sourceEventKey: state.message?.eventKey,
      text,
    });
    if (!z.strictObject({ ok: z.literal(true) }).safeParse(result).success)
      throw new LiveFailure('COMPOSER_BUSY');
  }
  async reset() {
    const tabIds = [...this.tabs.keys()];
    for (const tabId of this.pendingAutomatic.keys())
      this.cancelAutomatic(tabId);
    this.tabs.clear();
    await Promise.allSettled(
      tabIds.map((tabId) =>
        this.transport.send(tabId, { type: 'ADAPTER_RESET', version: 1 }),
      ),
    );
    this.transport.notify();
  }
}
