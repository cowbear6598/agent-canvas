import { describe, expect, it } from "vitest";
import {
  podSetPluginsSchema,
  podSetProviderSchema,
} from "../../src/schemas/podSchemas.js";
import { pastePodItemSchema } from "../../src/schemas/pasteSchemas.js";

describe("pod plugin id schema", () => {
  it("允許 pod:set-plugins 使用 upload bundle id", () => {
    const result = podSetPluginsSchema.safeParse({
      requestId: "44444444-4444-4444-8444-444444444444",
      canvasId: "11111111-1111-4111-8111-111111111111",
      podId: "22222222-2222-4222-8222-222222222222",
      pluginIds: ["upload:agent-canvas"],
    });

    expect(result.success).toBe(true);
  });

  it("允許 paste payload 使用 upload bundle id", () => {
    const result = pastePodItemSchema.safeParse({
      originalId: "33333333-3333-4333-8333-333333333333",
      name: "Pod 1",
      x: 10,
      y: 20,
      rotation: 0,
      pluginIds: ["upload:agent-canvas"],
    });

    expect(result.success).toBe(true);
  });
});

describe("pod provider schema", () => {
  it("拒絕未知 provider", () => {
    const result = podSetProviderSchema.safeParse({
      requestId: "44444444-4444-4444-8444-444444444444",
      canvasId: "11111111-1111-4111-8111-111111111111",
      podId: "22222222-2222-4222-8222-222222222222",
      provider: "gemini",
      providerConfig: { model: "gemini-2.5-pro" },
    });

    expect(result.success).toBe(false);
  });

  it("拒絕含非法欄位的 providerConfig", () => {
    const result = podSetProviderSchema.safeParse({
      requestId: "44444444-4444-4444-8444-444444444444",
      canvasId: "11111111-1111-4111-8111-111111111111",
      podId: "22222222-2222-4222-8222-222222222222",
      provider: "claude",
      providerConfig: {
        model: "sonnet",
        legacyProvider: "codex",
      },
    });

    expect(result.success).toBe(false);
  });
});
