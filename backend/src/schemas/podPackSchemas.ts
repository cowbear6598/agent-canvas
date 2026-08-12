import { z } from "zod";
import { pasteConnectionItemSchema, pastePodItemSchema } from "./pasteSchemas.js";

export const POD_PACK_FORMAT = "agent-canvas-pod-pack";
export const POD_PACK_VERSION = 1;

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const podPackPluginSchema = z
  .object({
    originalId: z.string().min(1).max(300),
    displayName: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    source: z.object({ type: z.enum(["github", "upload"]), ref: z.string().max(500) }).strict(),
    fingerprint: fingerprintSchema,
    bundlePath: z.string().regex(/^plugins\/[a-f0-9]{64}\.zip$/),
    skills: z.array(z.object({ skillName: z.string().max(500), description: z.string().max(4000) }).strict()).max(200),
    executableFiles: z.array(z.string().max(1000)).max(500),
  })
  .strict();

export const podPackMcpSchema = z
  .object({
    originalName: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9_.][a-zA-Z0-9_.-]*$/)
      .refine(
        (name) =>
          ![
            "agent_canvas_managed_surface",
            "agent_canvas_goal",
            "agent_canvas_plugin",
          ].includes(name),
        "不可使用系統保留的 MCP 名稱",
      ),
    fingerprint: fingerprintSchema,
    transport: z.enum(["stdio", "http", "sse"]),
    enabled: z.boolean(),
    command: z.string().max(1000).nullable(),
    args: z.array(z.string().max(4000)).max(100),
    url: z.string().url().max(4000).nullable(),
    envKeys: z
      .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(500))
      .max(32)
      .refine(
        (keys) =>
          keys.every((key) => {
            const upper = key.toUpperCase();
            return (
              upper !== "PATH" &&
              upper !== "NODE_OPTIONS" &&
              !upper.startsWith("LD_") &&
              !upper.startsWith("DYLD_")
            );
          }),
        "envKeys 包含不允許的環境變數名稱",
      ),
  })
  .strict();

export const podPackManifestSchema = z
  .object({
    format: z.literal(POD_PACK_FORMAT),
    version: z.literal(POD_PACK_VERSION),
    exportedAt: z.iso.datetime(),
    pods: z.array(pastePodItemSchema).min(1).max(50),
    connections: z.array(pasteConnectionItemSchema).max(100),
    plugins: z.array(podPackPluginSchema).max(100),
    managedMcps: z.array(podPackMcpSchema).max(100),
  })
  .strict();

export const podPackExportRequestSchema = z
  .object({
    pods: z.array(pastePodItemSchema).min(1).max(50),
    connections: z.array(pasteConnectionItemSchema).max(100),
  })
  .strict();

export const podPackImportOptionsSchema = z
  .object({
    canvasId: z.uuid(),
    targetX: z.number().finite(),
    targetY: z.number().finite(),
  })
  .strict();

export type PodPackManifest = z.infer<typeof podPackManifestSchema>;
export type PodPackExportRequest = z.infer<typeof podPackExportRequestSchema>;
export type PodPackImportOptions = z.infer<typeof podPackImportOptionsSchema>;
