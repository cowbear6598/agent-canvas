import { describe, expect, it } from "vitest";
import { createMockConnection } from "@tests/helpers/factories";
import type { DecideStatus } from "@/types/connection";
import {
  getPodWorkflowRoleFromConnections,
  isDownstreamWorkflowRunning,
  isPodPartOfRunningWorkflow,
} from "@/stores/connectionGraphHelpers";

describe("connectionGraphHelpers", () => {
  describe("workflow role 判斷", () => {
    it("依照上下游連線判斷 independent、head、tail、middle", () => {
      const connections = [
        createMockConnection({
          id: "conn-ab",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
        }),
        createMockConnection({
          id: "conn-bc",
          sourcePodId: "pod-b",
          targetPodId: "pod-c",
        }),
      ];

      expect(getPodWorkflowRoleFromConnections(connections, "pod-z")).toBe(
        "independent",
      );
      expect(getPodWorkflowRoleFromConnections(connections, "pod-a")).toBe(
        "head",
      );
      expect(getPodWorkflowRoleFromConnections(connections, "pod-c")).toBe(
        "tail",
      );
      expect(getPodWorkflowRoleFromConnections(connections, "pod-b")).toBe(
        "middle",
      );
    });
  });

  describe("graph traversal 規則", () => {
    it("下游 BFS 找到第二層 active connection 時回傳 true", () => {
      const connections = [
        createMockConnection({
          id: "conn-ab",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          status: "idle",
        }),
        createMockConnection({
          id: "conn-bc",
          sourcePodId: "pod-b",
          targetPodId: "pod-c",
          status: "active",
        }),
      ];

      expect(isDownstreamWorkflowRunning(connections, "pod-a")).toBe(true);
    });

    it("雙向 BFS 可從 tail 找到上游 queued connection", () => {
      const connections = [
        createMockConnection({
          id: "conn-ab",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          status: "queued",
        }),
      ];

      expect(isPodPartOfRunningWorkflow(connections, "pod-b")).toBe(true);
    });

    it("循環圖在所有 connection idle 時不會誤判為執行中", () => {
      const connections = [
        createMockConnection({
          id: "conn-ab",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          status: "idle",
        }),
        createMockConnection({
          id: "conn-ba",
          sourcePodId: "pod-b",
          targetPodId: "pod-a",
          status: "idle",
        }),
      ];

      expect(isDownstreamWorkflowRunning(connections, "pod-a")).toBe(false);
    });

    it("decideStatus pending 視為 workflow 執行中", () => {
      const connections = [
        createMockConnection({
          id: "conn-ab",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          status: "idle",
          decideStatus: "pending" as DecideStatus,
        }),
      ];

      expect(isDownstreamWorkflowRunning(connections, "pod-a")).toBe(true);
    });
  });
});
