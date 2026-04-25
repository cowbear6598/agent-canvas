import { z } from "zod";
import type { InstalledPlugin } from "../services/pluginScanner.js";

export const pluginListSchema = z.object({
  requestId: z.string(),
  provider: z.enum(["claude", "codex"]).optional(),
});

export type PluginListPayload = z.infer<typeof pluginListSchema>;

export interface PluginListResultPayload {
  requestId: string;
  success: boolean;
  plugins?: InstalledPlugin[];
  error?: string;
}
