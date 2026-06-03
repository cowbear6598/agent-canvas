import { describe, expect, it } from "vitest";
import { createMockConnection } from "@tests/helpers/factories";
import { DEFAULT_SUMMARY_MODEL } from "@/types/config";
import type { ConnectionPayloadItem } from "@/types/websocket";
import {
  mapConnectionUpdatedEventPayload,
  normalizeConnection,
  normalizeConnectionListPayload,
  normalizeConnectionUpdateResponsePayload,
  normalizeCreatedConnectionEvent,
} from "@/stores/connectionPayloadMappers";

describe("connectionPayloadMappers", () => {
  describe("payload normalize 規則", () => {
    it("缺少 triggerMode、status、decideStatus 時補預設值", () => {
      const connection = normalizeConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
      });

      expect(connection.triggerMode).toBe("auto");
      expect(connection.status).toBe("idle");
      expect(connection.decideStatus).toBe("none");
    });

    it("gemini summaryModel 會收斂成預設 summary model 與 claude provider", () => {
      const connection = normalizeConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        summaryModel: "gemini-2.5-pro",
      });

      expect(connection.summaryModel).toBe(DEFAULT_SUMMARY_MODEL);
      expect(connection.summaryProvider).toBe("claude");
    });

    it("list payload 依 sourcePodId 查 provider 後 normalize", () => {
      const [connection] = normalizeConnectionListPayload(
        [
          {
            id: "conn-1",
            sourcePodId: "pod-a",
            sourceAnchor: "bottom",
            targetPodId: "pod-b",
            targetAnchor: "top",
          },
        ],
        (sourcePodId) => (sourcePodId === "pod-a" ? "codex" : undefined),
      );

      expect(connection?.summaryProvider).toBe("codex");
    });

    it("normalize connection 會保留 summaryThinkingLevel", () => {
      const connection = normalizeConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        summaryThinkingLevel: "high",
      });

      expect(connection.summaryThinkingLevel).toBe("high");
    });

    it("normalize connection 會把空字串 label 收斂成 undefined", () => {
      const connection = normalizeConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        label: "",
      });

      expect(connection.label).toBeUndefined();
    });
  });

  describe("response event payload mapping 規則", () => {
    it("created event 補齊前端事件需要的 idle 狀態", () => {
      const connection = normalizeCreatedConnectionEvent({
        id: "conn-1",
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        triggerMode: "auto",
        direct: false,
        decideStatus: "pending",
      });

      expect(connection.status).toBe("idle");
      expect(connection.decideStatus).toBe("none");
    });

    it("created event 也會套用 legacy gemini summary normalize", () => {
      const connection = normalizeCreatedConnectionEvent({
        id: "conn-1",
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        summaryModel: "gemini-2.5-pro",
        summaryProvider: "opencode",
        triggerMode: "auto",
        direct: false,
        decideStatus: "none",
      });

      expect(connection.summaryModel).toBe(DEFAULT_SUMMARY_MODEL);
      expect(connection.summaryProvider).toBe("claude");
    });

    it("created event 的 summaryProvider 為 null 時，依 source provider 收斂", () => {
      const connection = normalizeCreatedConnectionEvent(
        {
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          summaryProvider: null,
          triggerMode: "auto",
          direct: false,
          decideStatus: "none",
        },
        "opencode",
      );

      expect(connection.summaryProvider).toBe("opencode");
    });

    it("created event 會把空字串 label 收斂成 undefined", () => {
      const connection = normalizeCreatedConnectionEvent({
        id: "conn-1",
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        triggerMode: "auto",
        direct: false,
        decideStatus: "none",
        label: "",
      });

      expect(connection.label).toBeUndefined();
    });

    it("updated event 未帶 connectionStatus 時保留既有 status", () => {
      const existingConnection = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        status: "waiting",
      });
      const payload: ConnectionPayloadItem = {
        id: "conn-1",
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
      };

      const mapped = mapConnectionUpdatedEventPayload(
        payload,
        existingConnection,
        () => "claude",
      );

      expect(mapped.status).toBe("waiting");
    });

    it("updated event 會保留既有 direct 並更新 summaryThinkingLevel", () => {
      const existingConnection = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        summaryThinkingLevel: "low",
        direct: true,
      });
      const payload: ConnectionPayloadItem = {
        id: "conn-1",
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        summaryThinkingLevel: "high",
      };

      const mapped = mapConnectionUpdatedEventPayload(
        payload,
        existingConnection,
        () => "claude",
      );

      expect(mapped.summaryThinkingLevel).toBe("high");
      expect(mapped.direct).toBe(true);
    });

    it("updated event 的 summaryProvider null 依 source provider fallback", () => {
      const existingConnection = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        summaryProvider: "claude",
      });
      const payload: ConnectionPayloadItem = {
        id: "conn-1",
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        summaryProvider: null,
      };

      const mapped = mapConnectionUpdatedEventPayload(
        payload,
        existingConnection,
        () => "opencode",
      );

      expect(mapped.summaryProvider).toBe("opencode");
    });

    it("updated event 也會套用 legacy gemini summary normalize", () => {
      const existingConnection = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        summaryModel: "claude-3-5-haiku-latest",
        summaryProvider: "codex",
      });
      const payload: ConnectionPayloadItem = {
        id: "conn-1",
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        summaryModel: "gemini-2.5-flash",
      };

      const mapped = mapConnectionUpdatedEventPayload(
        payload,
        existingConnection,
        () => "opencode",
      );

      expect(mapped.summaryModel).toBe(DEFAULT_SUMMARY_MODEL);
      expect(mapped.summaryProvider).toBe("claude");
    });

    it("updated event 會把空字串 label 收斂成 undefined", () => {
      const existingConnection = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        label: "Checklist",
      });
      const payload: ConnectionPayloadItem = {
        id: "conn-1",
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        label: "",
      };

      const mapped = mapConnectionUpdatedEventPayload(
        payload,
        existingConnection,
        () => "claude",
      );

      expect(mapped.label).toBeUndefined();
    });

    it("update response mapper 應優先使用 connections 陣列", () => {
      const connection = {
        id: "conn-1",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
      } satisfies ConnectionPayloadItem;

      expect(
        normalizeConnectionUpdateResponsePayload({
          requestId: "request-1",
          success: true,
          connection: {
            ...connection,
            id: "single-conn",
          },
          connections: [connection],
        }),
      ).toEqual([connection]);
    });

    it("update response mapper 應支援單一 connection 與空回應", () => {
      const connection = {
        id: "conn-1",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
      } satisfies ConnectionPayloadItem;

      expect(
        normalizeConnectionUpdateResponsePayload({
          requestId: "request-1",
          success: true,
          connection,
        }),
      ).toEqual([connection]);
      expect(
        normalizeConnectionUpdateResponsePayload({
          requestId: "request-2",
          success: true,
        }),
      ).toEqual([]);
    });
  });
});
