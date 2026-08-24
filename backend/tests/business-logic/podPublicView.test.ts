import { describe, expect, it } from "vitest";
import { WebSocketResponseEvents } from "../../src/schemas/index.js";
import { parseServerEventPayload } from "../../src/schemas/serverEventManifest.js";
import { toPodPublicView, type Pod } from "../../src/types/pod.js";

function createBasePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-public-view-test",
    name: "public-view-test",
    workspacePath: "/tmp/private-workspace",
    x: 10,
    y: 20,
    rotation: 0,
    sessionId: "private-session-id",
    mcpServerNames: [],
    pluginIds: [],
    codexSkillKeys: [],
    codexSkillsInitialized: true,
    provider: "claude",
    providerConfig: { model: "sonnet" },
    repositoryId: null,
    goal: null,
    memoryEnabled: true,
    repoMemoryEnabled: false,
    hasPodMemory: false,
    hasRepoMemory: false,
    ...overrides,
  };
}

describe("toPodPublicView", () => {
  it("應將內部 Date 型別的 schedule.lastTriggeredAt 序列化成 ISO 字串", () => {
    const lastTriggeredAt = new Date("2026-03-19T08:00:00.000Z");
    const pod = createBasePod({
      schedule: {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 10,
        intervalHour: 1,
        hour: 9,
        minute: 30,
        weekdays: [],
        enabled: true,
        lastTriggeredAt,
      },
    });

    const publicView = toPodPublicView(pod);

    expect(publicView.schedule?.lastTriggeredAt).toBe(
      "2026-03-19T08:00:00.000Z",
    );
    expect(publicView).not.toHaveProperty("workspacePath");
    expect(publicView).not.toHaveProperty("sessionId");
    expect(publicView).not.toHaveProperty("codexSkillsInitialized");
    expect(() =>
      parseServerEventPayload(WebSocketResponseEvents.POD_LIST_RESULT, {
        requestId: "request-public-view-test",
        success: true,
        pods: [publicView],
      }),
    ).not.toThrow();
  });
});
