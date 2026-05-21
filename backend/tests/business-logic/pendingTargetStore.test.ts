import { pendingTargetStore } from "../../src/services/pendingTargetStore.js";

describe("PendingTargetStore", () => {
  const targetPodId = "target-pod-1";
  const sourcePodId1 = "source-pod-1";
  const sourcePodId2 = "source-pod-2";
  const sourcePodId3 = "source-pod-3";

  beforeEach(() => {
    // 清空 store（透過刪除所有 pending targets）
    pendingTargetStore.clearPendingTarget(targetPodId);
    pendingTargetStore.clearPendingTarget("target-pod-2");
    pendingTargetStore.clearPendingTarget("target-pod-3");
    pendingTargetStore.clearPendingTarget("lazy-target-pod");
  });

  describe("recordSourceRejection 正確記錄被拒絕的來源", () => {
    it("記錄單一 rejection", () => {
      pendingTargetStore.initializePendingTarget(targetPodId, [
        sourcePodId1,
        sourcePodId2,
      ]);

      pendingTargetStore.recordSourceRejection(
        targetPodId,
        sourcePodId1,
        "上游產出與下游任務無關",
      );

      const rejections = pendingTargetStore.getRejectedSources(targetPodId);
      expect(rejections).toBeDefined();
      expect(rejections?.size).toBe(1);
      expect(rejections?.get(sourcePodId1)).toBe("上游產出與下游任務無關");
    });

    it("記錄多個 rejections", () => {
      pendingTargetStore.initializePendingTarget(targetPodId, [
        sourcePodId1,
        sourcePodId2,
        sourcePodId3,
      ]);

      pendingTargetStore.recordSourceRejection(
        targetPodId,
        sourcePodId1,
        "Reason 1",
      );
      pendingTargetStore.recordSourceRejection(
        targetPodId,
        sourcePodId2,
        "Reason 2",
      );

      const rejections = pendingTargetStore.getRejectedSources(targetPodId);
      expect(rejections?.size).toBe(2);
      expect(rejections?.get(sourcePodId1)).toBe("Reason 1");
      expect(rejections?.get(sourcePodId2)).toBe("Reason 2");
    });
  });

  describe("hasAnyRejectedSource 偵測到有被拒絕的來源", () => {
    it("有 rejection 時回傳 true", () => {
      pendingTargetStore.initializePendingTarget(targetPodId, [
        sourcePodId1,
        sourcePodId2,
      ]);
      pendingTargetStore.recordSourceRejection(
        targetPodId,
        sourcePodId1,
        "Rejected",
      );

      expect(pendingTargetStore.hasAnyRejectedSource(targetPodId)).toBe(true);
    });

    it("沒有 rejection 時回傳 false", () => {
      pendingTargetStore.initializePendingTarget(targetPodId, [
        sourcePodId1,
        sourcePodId2,
      ]);

      expect(pendingTargetStore.hasAnyRejectedSource(targetPodId)).toBe(false);
    });

    it("pending target 不存在時回傳 false", () => {
      expect(pendingTargetStore.hasAnyRejectedSource("nonexistent")).toBe(
        false,
      );
    });
  });

  describe("getRejectedSources 回傳所有被拒絕的來源及 reason", () => {
    it("回傳正確的 rejections Map", () => {
      pendingTargetStore.initializePendingTarget(targetPodId, [
        sourcePodId1,
        sourcePodId2,
        sourcePodId3,
      ]);

      pendingTargetStore.recordSourceRejection(
        targetPodId,
        sourcePodId1,
        "Reason A",
      );
      pendingTargetStore.recordSourceRejection(
        targetPodId,
        sourcePodId3,
        "Reason C",
      );

      const rejections = pendingTargetStore.getRejectedSources(targetPodId);

      expect(rejections).toBeDefined();
      expect(rejections?.size).toBe(2);
      expect(rejections?.get(sourcePodId1)).toBe("Reason A");
      expect(rejections?.get(sourcePodId3)).toBe("Reason C");
      expect(rejections?.has(sourcePodId2)).toBe(false);
    });

    it("pending target 不存在時回傳 undefined", () => {
      const rejections = pendingTargetStore.getRejectedSources("nonexistent");
      expect(rejections).toBeUndefined();
    });
  });

  describe("多輸入場景中部分 rejected 時，isReadyToTrigger 永遠為 false", () => {
    it("有 rejection 時，即使所有 sources 都回應，hasRejection 為 true", () => {
      pendingTargetStore.initializePendingTarget(targetPodId, [
        sourcePodId1,
        sourcePodId2,
        sourcePodId3,
      ]);

      // source 1 完成
      pendingTargetStore.recordSourceCompletion(
        targetPodId,
        sourcePodId1,
        "Summary 1",
      );

      // source 2 被拒絕
      pendingTargetStore.recordSourceRejection(
        targetPodId,
        sourcePodId2,
        "Rejected",
      );

      // source 3 完成
      const result = pendingTargetStore.recordSourceCompletion(
        targetPodId,
        sourcePodId3,
        "Summary 3",
      );

      // 所有 sources 都回應了（1 完成 + 1 拒絕 + 1 完成 = 3）
      expect(result.allSourcesResponded).toBe(true);
      // 但因為有 rejection，hasRejection 為 true
      expect(result.hasRejection).toBe(true);

      expect(pendingTargetStore.hasAnyRejectedSource(targetPodId)).toBe(true);
    });

    it("全部 rejected 時，allSourcesResponded 和 hasRejection 都為 true", () => {
      pendingTargetStore.initializePendingTarget(targetPodId, [
        sourcePodId1,
        sourcePodId2,
      ]);

      pendingTargetStore.recordSourceRejection(
        targetPodId,
        sourcePodId1,
        "Rejected 1",
      );
      pendingTargetStore.recordSourceRejection(
        targetPodId,
        sourcePodId2,
        "Rejected 2",
      );

      const pending = pendingTargetStore.getPendingTarget(targetPodId);
      const allSourcesResponded =
        (pending?.completedSources.size ?? 0) +
          (pending?.rejectedSources.size ?? 0) >=
        (pending?.requiredSourcePodIds.length ?? 0);

      expect(allSourcesResponded).toBe(true);
      expect(pendingTargetStore.hasAnyRejectedSource(targetPodId)).toBe(true);
    });
  });

  // ─── Bug A 驗收：recordSourceRejection 早到時的 lazy init 行為 ────────────────

  describe("recordSourceRejection 早到時的 lazy init 行為（Bug A 回歸測試）", () => {
    const lazyTargetPodId = "lazy-target-pod";

    beforeEach(() => {
      pendingTargetStore.clearPendingTarget(lazyTargetPodId);
    });

    it("Case 1：未呼叫 initializePendingTarget 直接呼叫 recordSourceRejection（帶 requiredSourcePodIds）可正常 lazy init", () => {
      // 不事先呼叫 initializePendingTarget
      expect(pendingTargetStore.hasPendingTarget(lazyTargetPodId)).toBe(false);

      pendingTargetStore.recordSourceRejection(
        lazyTargetPodId,
        sourcePodId1,
        "早到的 rejection",
        [sourcePodId1, sourcePodId2],
      );

      // lazy init 後應可查到 rejectedSources
      const rejections = pendingTargetStore.getRejectedSources(lazyTargetPodId);
      expect(rejections?.size).toBe(1);

      // hasPendingTarget 應回傳 true（已 lazy init）
      expect(pendingTargetStore.hasPendingTarget(lazyTargetPodId)).toBe(true);
    });

    it("Case 2：承接 Case 1，recordSourceCompletion 第二個 source 後回傳 { allSourcesResponded: true, hasRejection: true }", () => {
      // 先 lazy init（模擬 Case 1 的狀態）
      pendingTargetStore.recordSourceRejection(
        lazyTargetPodId,
        sourcePodId1,
        "早到的 rejection",
        [sourcePodId1, sourcePodId2],
      );

      // 第二個 source 晚到，呼叫 recordSourceCompletion
      const result = pendingTargetStore.recordSourceCompletion(
        lazyTargetPodId,
        sourcePodId2,
        "第二個 source 的摘要",
      );

      // 所有 sources 都回應了，且有 rejection
      expect(result.allSourcesResponded).toBe(true);
      expect(result.hasRejection).toBe(true);
    });
  });
});
