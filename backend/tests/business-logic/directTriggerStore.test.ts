import { directTriggerStore } from "../../src/services/directTriggerStore.js";

describe("DirectTriggerStore", () => {
  const targetPodId = "target-pod-1";
  const sourcePodId1 = "source-pod-1";

  beforeEach(() => {
    directTriggerStore.clearDirectPending(targetPodId);
    directTriggerStore.clearDirectPending("target-pod-2");
  });

  describe("基本功能", () => {
    it("clearDirectPending 正確清除", () => {
      directTriggerStore.initializeDirectPending(targetPodId);
      directTriggerStore.recordDirectReady(
        targetPodId,
        sourcePodId1,
        "Summary 1",
      );

      directTriggerStore.clearDirectPending(targetPodId);

      expect(directTriggerStore.hasDirectPending(targetPodId)).toBe(false);
      expect(directTriggerStore.getReadySummaries(targetPodId)).toBeNull();
    });
  });

  describe("倒數計時", () => {
    it("hasActiveTimer 正確偵測倒數狀態", () => {
      directTriggerStore.initializeDirectPending(targetPodId);

      expect(directTriggerStore.hasActiveTimer(targetPodId)).toBe(false);

      const timer = setTimeout(() => {}, 1000);
      directTriggerStore.setTimer(targetPodId, timer);

      expect(directTriggerStore.hasActiveTimer(targetPodId)).toBe(true);

      clearTimeout(timer);
    });
  });
});
