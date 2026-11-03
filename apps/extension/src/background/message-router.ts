import type { StorageArea } from '../storage/settings-repository.js';
import type { SettingsRepository } from '../storage/settings-repository.js';
import {
  DemoRunSchema,
  ShellRequestSchema,
  ShellStateSchema,
} from '../messaging/contracts.js';
import type { ErrorCode, ShellResponse } from '../messaging/contracts.js';
import { createMockFlow } from './mock-flow.js';
import type { LiveController } from './live-controller.js';
import { LiveFailure } from './live-controller.js';

export const DEMO_KEY = 'assistant.mock.v1';
const allowedPages = new Set([
  '/popup.html',
  '/sidepanel.html',
  '/options.html',
]);
export interface Sender {
  id?: string | undefined;
  url?: string | undefined;
  frameId?: number | undefined;
  tab?: { id?: number | undefined } | undefined;
}

export function isTrustedPage(sender: Sender, extensionId: string): boolean {
  if (
    sender.id !== extensionId ||
    (sender.frameId !== undefined && sender.frameId !== 0)
  )
    return false;
  try {
    const url = new URL(sender.url ?? '');
    return (
      url.protocol === 'chrome-extension:' &&
      url.hostname === extensionId &&
      allowedPages.has(url.pathname)
    );
  } catch {
    return false;
  }
}
class RouteError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

export function createMessageRouter(
  repository: SettingsRepository,
  session: StorageArea,
  extensionId: string,
  live?: LiveController,
) {
  // Serialize read/modify/write requests within each worker lifetime.
  let pending: Promise<unknown> = Promise.resolve();
  async function snapshot(): Promise<ShellResponse> {
    const settings = await repository.load();
    const stored = (await session.get(DEMO_KEY))[DEMO_KEY];
    const parsed = DemoRunSchema.safeParse(stored);
    const demo =
      parsed.success && parsed.data.profileId === settings.activeProfileId
        ? parsed.data
        : null;
    return {
      ok: true,
      state: ShellStateSchema.parse({
        settings,
        demo,
        adapterStatus: live?.snapshot(settings).live?.status.ready
          ? 'READY'
          : 'WAITING',
        knowledgeStatus: 'SAMPLE_DATA',
        ...(live ? live.snapshot(settings) : {}),
      }),
    };
  }
  async function route(input: unknown, sender: Sender): Promise<ShellResponse> {
    if (!isTrustedPage(sender, extensionId))
      return { ok: false, error: 'UNAUTHORIZED' };
    const parsed = ShellRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'INVALID_REQUEST' };
    const request = parsed.data;
    try {
      switch (request.type) {
        case 'SET_CHAT_TAKEOVER':
          if (!live) throw new RouteError('UNAVAILABLE');
          await live.setTakeover(request.context, request.paused);
          break;
        case 'RECONNECT_WHATSAPP':
          if (!live) throw new RouteError('UNAVAILABLE');
          await live.reconnect();
          break;
        case 'CONNECT_BACKEND':
          if (!live) throw new RouteError('UNAVAILABLE');
          await live.connect(request.token, request.autoSuggest);
          break;
        case 'DISCONNECT_BACKEND':
          await live?.disconnect();
          break;
        case 'RETRY_SUGGESTION':
          if (!live) throw new RouteError('UNAVAILABLE');
          await live.retry();
          break;
        case 'INSERT_LIVE_DRAFT':
          if (!live) throw new RouteError('UNAVAILABLE');
          await live.insert(request.suggestionId, request.text);
          break;
        case 'SAVE_SELECTORS':
          await repository.update((settings) => ({
            ...settings,
            selectors: request.selectors,
          }));
          await live?.reset();
          break;
        case 'GET_STATE':
          break;
        case 'SET_ENABLED':
          await repository.update((settings) => ({
            ...settings,
            enabled: request.enabled,
          }));
          await live?.reset();
          break;
        case 'SET_ACTIVE_PROFILE':
          await repository.update((settings) => {
            if (
              !settings.profiles.some(
                (profile) => profile.id === request.profileId,
              )
            )
              throw new RouteError('PROFILE_CHANGED');
            return { ...settings, activeProfileId: request.profileId };
          });
          await live?.reset();
          break;
        case 'SAVE_PROFILE':
          await repository.update((settings) => {
            const edit = request.edit;
            if (settings.revision !== edit.expectedRevision)
              throw new RouteError('CONFLICT');
            if (settings.activeProfileId !== edit.profileId)
              throw new RouteError('PROFILE_CHANGED');
            return {
              ...settings,
              profiles: settings.profiles.map((profile) =>
                profile.id !== edit.profileId
                  ? profile
                  : {
                      ...profile,
                      name: edit.name,
                      tone: edit.tone,
                      defaultLanguage: edit.defaultLanguage,
                      timezone: edit.timezone,
                      replyMode: edit.replyMode,
                      webAutoSendOptIn: edit.webAutoSendOptIn,
                      behavior: {
                        ...profile.behavior,
                        perChatCooldownSeconds:
                          edit.perChatCooldownSeconds ??
                          profile.behavior.perChatCooldownSeconds,
                      },
                      replyInstructions: edit.replyInstructions,
                      businessInformation: edit.businessInformation,
                      workingHours: {
                        ...profile.workingHours,
                        description: edit.workingHours,
                      },
                    },
              ),
            };
          });
          await live?.reset();
          break;
        case 'RUN_MOCK': {
          const settings = await repository.load();
          const profile = settings.profiles.find(
            (item) => item.id === settings.activeProfileId,
          );
          if (settings.activeProfileId !== request.profileId)
            throw new RouteError('PROFILE_CHANGED');
          if (!settings.enabled || profile?.replyMode !== 'DRAFT_ONLY')
            throw new RouteError('DISABLED');
          if (
            profile.knowledgeSource.type !== 'STATIC_JSON' ||
            profile.knowledgeSource.datasetId !== 'bakery-demo'
          )
            throw new RouteError('UNAVAILABLE');
          const demo = await createMockFlow(profile.id);
          await session.set({ [DEMO_KEY]: demo });
          break;
        }
      }
      return await snapshot();
    } catch (error) {
      // Never serialize an exception, raw external data, or storage content to logs/UI.
      return {
        ok: false,
        error:
          error instanceof RouteError || error instanceof LiveFailure
            ? error.code
            : 'STORAGE_ERROR',
      };
    }
  }
  return (input: unknown, sender: Sender): Promise<ShellResponse> => {
    const result = pending.then(() => route(input, sender));
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
