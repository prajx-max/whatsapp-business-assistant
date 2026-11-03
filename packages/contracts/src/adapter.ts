import { z } from 'zod';
import { ChatKeySchema, IdSchema } from './entities.js';

export const selectorNames = [
  'appShell',
  'chatHeader',
  'messageList',
  'incomingMessage',
  'outgoingMessage',
  'messageText',
  'composer',
  'sendButton',
] as const;
export const SelectorPackSchema = z.strictObject({
  version: z.number().int().positive(),
  appShell: z.array(z.string().min(1).max(300)).min(1).max(8),
  chatHeader: z.array(z.string().min(1).max(300)).min(1).max(8),
  messageList: z.array(z.string().min(1).max(300)).min(1).max(8),
  incomingMessage: z.array(z.string().min(1).max(300)).min(1).max(8),
  outgoingMessage: z.array(z.string().min(1).max(300)).min(1).max(8),
  messageText: z.array(z.string().min(1).max(300)).min(1).max(8),
  composer: z.array(z.string().min(1).max(300)).min(1).max(8),
  sendButton: z.array(z.string().min(1).max(300)).min(1).max(8),
  themeDirection: z
    .strictObject({
      row: z.string().min(1).max(300),
      bubble: z.string().min(1).max(300),
      incomingVariable: z.string().regex(/^--[a-z-]{1,60}$/),
      outgoingVariable: z.string().regex(/^--[a-z-]{1,60}$/),
    })
    .optional(),
});
export const legacySelectors = SelectorPackSchema.parse({
  version: 1,
  appShell: ['#main'],
  chatHeader: [
    '#main header [data-testid="conversation-info-header-chat-title"]',
    '#main header [title]',
    '[data-assistant-chat-title]',
  ],
  messageList: [
    '#main [data-testid="conversation-panel-messages"]',
    '#main [role="application"]',
    '[data-assistant-message-list]',
  ],
  incomingMessage: ['.message-in', '[data-message-direction="in"]'],
  outgoingMessage: ['.message-out', '[data-message-direction="out"]'],
  messageText: [
    '[data-testid="msg-text"]',
    '.selectable-text.copyable-text',
    '[data-assistant-message-text]',
  ],
  composer: [
    '#main footer [contenteditable="true"][role="textbox"]',
    '#main [data-testid="conversation-compose-box-input"]',
  ],
  sendButton: [
    '#main footer button[aria-label="Send"]',
    '#main [data-testid="compose-btn-send"]',
  ],
});
export const selectorsV2 = SelectorPackSchema.parse({
  ...legacySelectors,
  version: 2,
  chatHeader: [
    ...legacySelectors.chatHeader,
    '#main header [data-testid="conversation-info-header-chat-title"] span',
    '#main header span[dir="auto"]',
  ],
  messageList: [
    ...legacySelectors.messageList,
    '#main [data-testid="conversation-panel-body"]',
    '#main [role="grid"]',
    '#main [role="log"]',
  ],
  composer: [
    ...legacySelectors.composer,
    '#main footer [contenteditable="true"][data-lexical-editor="true"]',
  ],
});
export const selectorsV3 = SelectorPackSchema.parse({
  ...selectorsV2,
  version: 3,
  incomingMessage: [...selectorsV2.incomingMessage, '[data-id^="false_"]'],
  outgoingMessage: [...selectorsV2.outgoingMessage, '[data-id^="true_"]'],
});
export const defaultSelectors = SelectorPackSchema.parse({
  ...selectorsV3,
  version: 4,
  themeDirection: {
    row: '[data-testid^="conv-msg-"]',
    bubble: '[data-testid="msg-container"] > div',
    incomingVariable: '--incoming-background',
    outgoingVariable: '--outgoing-background',
  },
});
export const AdapterConfigSchema = z.strictObject({
  buildVersion: z.string().max(30).optional(),
  profileId: IdSchema,
  enabled: z.boolean(),
  autoSendEnabled: z.boolean().optional(),
  salt: z.string().min(16).max(128),
  selectors: SelectorPackSchema,
  duplicateWindowSeconds: z.number().int().min(1).max(86400),
});
export const AdapterContextSchema = z.strictObject({
  profileId: IdSchema,
  chatKey: ChatKeySchema,
  contextId: IdSchema,
  chatLabel: z.string().max(120),
});
export const AdapterStructureSchema = z.strictObject({
  buildVersion: z.string().max(30),
  selectorVersion: z.number().int().positive(),
  enabled: z.boolean(),
  textNodesInList: z.number().int().min(0).max(10000),
  textNodesInMain: z.number().int().min(0).max(10000),
  incomingNodesInList: z.number().int().min(0).max(10000),
  outgoingNodesInList: z.number().int().min(0).max(10000),
  listContainsComposer: z.boolean(),
  samples: z
    .array(
      z
        .array(
          z.strictObject({
            tag: z.string().max(20),
            role: z.enum([
              'row',
              'gridcell',
              'grid',
              'list',
              'listitem',
              'application',
              'log',
              'textbox',
              'other',
              'none',
            ]),
            attributes: z
              .array(z.string().regex(/^data-[a-z-]{1,40}$/))
              .max(20),
            idFormat: z.enum([
              'missing',
              'incoming-prefix',
              'outgoing-prefix',
              'other',
            ]),
            classes: z.array(z.string().max(30)).max(12),
          }),
        )
        .max(8),
    )
    .max(3),
});
export type AdapterStructure = z.infer<typeof AdapterStructureSchema>;
export const AdapterControlSchema = z.strictObject({
  type: z.enum(['ADAPTER_RESET', 'ADAPTER_RESUME']),
  version: z.literal(1),
});
export type AdapterControl = z.infer<typeof AdapterControlSchema>;
export const AdapterStatusSchema = z.strictObject({
  ready: z.boolean(),
  context: AdapterContextSchema.nullable(),
  matches: z.record(z.enum(selectorNames), z.number().int().min(-1).max(7)),
  structure: AdapterStructureSchema.optional(),
});
export const AdapterRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('ADAPTER_POLL'),
    version: z.literal(1),
    context: AdapterContextSchema,
  }),
  z.strictObject({
    type: z.literal('ADAPTER_BOOTSTRAP'),
    version: z.literal(1),
  }),
  z.strictObject({
    type: z.literal('ADAPTER_STATUS'),
    version: z.literal(1),
    status: AdapterStatusSchema,
  }),
  z.strictObject({
    type: z.literal('ADAPTER_AUTHORIZE_SEND'),
    version: z.literal(1),
    context: AdapterContextSchema,
    sourceEventKey: ChatKeySchema,
    deliveryId: z.uuid(),
    replyHash: ChatKeySchema,
  }),
  z.strictObject({
    type: z.literal('ADAPTER_MESSAGE'),
    version: z.literal(1),
    context: AdapterContextSchema,
    eventKey: z.string().regex(/^[a-f0-9]{64}$/),
    text: z.string().trim().min(1).max(16000),
  }),
]);
export const AdapterAckSchema = z.strictObject({
  ok: z.boolean(),
  pollAfterMs: z.number().int().min(250).max(5000).optional(),
});
export const InsertCommandSchema = z.strictObject({
  type: z.literal('INSERT_APPROVED_DRAFT'),
  version: z.literal(1),
  context: AdapterContextSchema,
  sourceEventKey: ChatKeySchema.optional(),
  text: z.string().trim().min(1).max(4000),
});
export const AutoSendCommandSchema = z.strictObject({
  type: z.literal('SEND_AUTOMATIC_REPLY'),
  version: z.literal(1),
  context: AdapterContextSchema,
  sourceEventKey: ChatKeySchema,
  deliveryId: z.uuid(),
  text: z.string().trim().min(1).max(4000),
});
export const AutoSendResultSchema = z.strictObject({
  state: z.enum(['SENT', 'BLOCKED', 'UNCERTAIN']),
  reason: z.enum([
    'ACCEPTED_BY_WHATSAPP',
    'CONTEXT_CHANGED',
    'COMPOSER_BUSY',
    'SEND_UNAVAILABLE',
    'AUTHORIZATION_REVOKED',
    'SEND_UNCONFIRMED',
  ]),
});
export type AutoSendResult = z.infer<typeof AutoSendResultSchema>;
export const LiveStateSchema = z.strictObject({
  tabId: z.number().int().nonnegative(),
  status: AdapterStatusSchema,
  message: z
    .strictObject({
      eventKey: IdSchema,
      text: z.string().max(16000),
      receivedAt: z.number().nonnegative().optional(),
    })
    .nullable(),
  suggestion: z
    .strictObject({
      id: IdSchema,
      state: z.enum(['WAITING', 'GENERATING', 'READY', 'ERROR']),
      reply: z.string().max(4000),
      needsHuman: z.boolean(),
      standardFallback: z.boolean().optional(),
      provider: z.string().max(32),
      model: z.string().max(128),
      error: z.string().max(100),
      delivery: z
        .strictObject({
          state: z.enum(['SENDING', 'SENT', 'BLOCKED', 'UNCERTAIN']),
          reason: z.string().max(100),
        })
        .optional(),
    })
    .nullable(),
});
export type SelectorPack = z.infer<typeof SelectorPackSchema>;
export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;
export type AdapterContext = z.infer<typeof AdapterContextSchema>;
export type AdapterStatus = z.infer<typeof AdapterStatusSchema>;
export type AdapterRequest = z.infer<typeof AdapterRequestSchema>;
export type LiveState = z.infer<typeof LiveStateSchema>;
