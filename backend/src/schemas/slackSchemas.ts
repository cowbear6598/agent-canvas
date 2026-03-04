import { z } from 'zod';

export const slackAppListSchema = z.object({});

export const slackAppCreateSchema = z.object({
  name: z.string().min(1).max(100),
  botToken: z.string().startsWith('xoxb-'),
  signingSecret: z.string().regex(/^[a-f0-9]{32}$/, 'Signing Secret 格式不正確'),
});

const slackAppIdOnlySchema = z.object({
  slackAppId: z.string().uuid(),
});

export const slackAppDeleteSchema = slackAppIdOnlySchema;
export const slackAppGetSchema = slackAppIdOnlySchema;
export const slackAppChannelsSchema = slackAppIdOnlySchema;
export const slackAppChannelsRefreshSchema = slackAppIdOnlySchema;

export const podBindSlackSchema = z.object({
  canvasId: z.string().uuid(),
  podId: z.string().uuid(),
  slackAppId: z.string().uuid(),
  slackChannelId: z.string().min(1),
});

export const podUnbindSlackSchema = z.object({
  canvasId: z.string().uuid(),
  podId: z.string().uuid(),
});

export type SlackAppListPayload = z.infer<typeof slackAppListSchema>;
export type SlackAppCreatePayload = z.infer<typeof slackAppCreateSchema>;
export type SlackAppDeletePayload = z.infer<typeof slackAppDeleteSchema>;
export type SlackAppGetPayload = z.infer<typeof slackAppGetSchema>;
export type SlackAppChannelsPayload = z.infer<typeof slackAppChannelsSchema>;
export type SlackAppChannelsRefreshPayload = z.infer<typeof slackAppChannelsRefreshSchema>;
export type PodBindSlackPayload = z.infer<typeof podBindSlackSchema>;
export type PodUnbindSlackPayload = z.infer<typeof podUnbindSlackSchema>;
