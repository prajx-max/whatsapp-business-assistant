import { z } from 'zod';
import { BusinessProfileSchema, ChatKeySchema, IdSchema } from './entities.js';

export const ProviderSchema = z.enum(['openai', 'gemini', 'anthropic']);
export const ModelIdSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/);
export const ProviderConfigurationSchema = z.strictObject({
  profileId: IdSchema,
  provider: ProviderSchema,
  model: ModelIdSchema,
  apiKey: z
    .string()
    .trim()
    .max(512)
    .regex(/^[a-zA-Z0-9_.:-]{8,512}$/)
    .optional(),
  remember: z.boolean().optional(),
});
export const ProviderStatusSchema = z.strictObject({
  configured: z.boolean(),
  provider: ProviderSchema.nullable(),
  model: z.string().max(128),
});
export const ModelReplySchema = z.strictObject({
  reply: z.string().trim().min(1).max(4000),
  needsHuman: z.boolean(),
  evidenceIds: z.array(z.enum(['business-information'])).max(1),
});
export const SuggestionRequestSchema = z.strictObject({
  profileId: IdSchema,
  chatKey: ChatKeySchema,
  requestId: IdSchema,
  text: z.string().trim().min(1).max(16000),
});
export const SuggestionResponseSchema = z.strictObject({
  requestId: IdSchema,
  reply: z.string().min(1).max(4000),
  needsHuman: z.boolean(),
  provider: ProviderSchema,
  model: ModelIdSchema,
  grounded: z.boolean(),
});
export const ProfileSyncSchema = z.strictObject({
  profile: BusinessProfileSchema,
});
export const ServiceErrorSchema = z.enum([
  'NOT_CONFIGURED',
  'UNAUTHORIZED',
  'INVALID_REQUEST',
  'KEY_REJECTED',
  'MODEL_REJECTED',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'INVALID_OUTPUT',
  'PROFILE_MISSING',
  'CONFIGURATION_SAVE_FAILED',
]);
export type Provider = z.infer<typeof ProviderSchema>;
export type ProviderConfiguration = z.infer<typeof ProviderConfigurationSchema>;
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
export type ModelReply = z.infer<typeof ModelReplySchema>;
export type SuggestionRequest = z.infer<typeof SuggestionRequestSchema>;
export type ServiceError = z.infer<typeof ServiceErrorSchema>;
