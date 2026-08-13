import { describe, expect, it } from "vitest";
import { createMockConnection } from "@tests/helpers/factories";
import { getPodWorkflowRoleFromConnections } from "@/stores/connectionGraphHelpers";

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
});
