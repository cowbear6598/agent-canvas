import { z } from "zod";
import type { ManagedPluginRecord } from "../services/plugin/managedPluginRegistry.js";

export const pluginListSchema = z.object({
  requestId: z.string(),
});

export type PluginListPayload = z.infer<typeof pluginListSchema>;

export const pluginInstallSchema = z.object({
  requestId: z.string(),
  githubRepo: z.string().min(1).max(200),
});

export type PluginInstallPayload = z.infer<typeof pluginInstallSchema>;

export const pluginDeleteSchema = z.object({
  requestId: z.string(),
  pluginId: z.string().min(1).max(200),
});

export type PluginDeletePayload = z.infer<typeof pluginDeleteSchema>;

export const pluginUpdateSchema = z.object({
  requestId: z.string(),
  pluginId: z.string().min(1).max(200),
});

export type PluginUpdatePayload = z.infer<typeof pluginUpdateSchema>;

export const pluginReorderSchema = z.object({
  requestId: z.string(),
  pluginIds: z
    .array(z.string().min(1).max(200))
    .min(1, "Plugin IDs array cannot be empty")
    .max(200, "Plugin IDs exceed limit"),
});

export type PluginReorderPayload = z.infer<typeof pluginReorderSchema>;

export interface PluginListResultPayload {
  requestId: string;
  success: boolean;
  plugins?: ManagedPluginRecord[];
  error?: string;
}

export interface PluginInstallResultPayload {
  requestId: string;
  success: boolean;
  plugin?: ManagedPluginRecord;
  error?: string;
}

export interface PluginDeleteResultPayload {
  requestId: string;
  success: boolean;
  pluginId?: string;
  plugins?: ManagedPluginRecord[];
  error?: string;
}

export interface PluginUpdateResultPayload {
  requestId: string;
  success: boolean;
  plugin?: ManagedPluginRecord;
  error?: string;
}

export interface PluginReorderResultPayload {
  requestId: string;
  success: boolean;
  plugins?: ManagedPluginRecord[];
  error?: string;
}
