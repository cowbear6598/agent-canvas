import { z } from "zod";

const MAX_PLUGIN_IDENTIFIER_LENGTH = 200;
const MAX_PLUGIN_REORDER_IDS = 200;

export const pluginListSchema = z.object({
  requestId: z.string(),
});

export type PluginListPayload = z.infer<typeof pluginListSchema>;

export const pluginInstallSchema = z.object({
  requestId: z.string(),
  githubRepo: z.string().min(1).max(MAX_PLUGIN_IDENTIFIER_LENGTH),
});

export type PluginInstallPayload = z.infer<typeof pluginInstallSchema>;

export const pluginDeleteSchema = z.object({
  requestId: z.string(),
  pluginId: z.string().min(1).max(MAX_PLUGIN_IDENTIFIER_LENGTH),
});

export type PluginDeletePayload = z.infer<typeof pluginDeleteSchema>;

export const pluginUpdateSchema = z.object({
  requestId: z.string(),
  pluginId: z.string().min(1).max(MAX_PLUGIN_IDENTIFIER_LENGTH),
});

export type PluginUpdatePayload = z.infer<typeof pluginUpdateSchema>;

export const pluginReorderSchema = z.object({
  requestId: z.string(),
  pluginIds: z
    .array(z.string().min(1).max(MAX_PLUGIN_IDENTIFIER_LENGTH))
    .min(1, "Plugin IDs array cannot be empty")
    .max(MAX_PLUGIN_REORDER_IDS, "Plugin IDs exceed limit"),
});

export type PluginReorderPayload = z.infer<typeof pluginReorderSchema>;
