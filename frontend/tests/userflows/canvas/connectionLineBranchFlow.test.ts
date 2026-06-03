import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import ConnectionLine from "@/components/canvas/ConnectionLine.vue";
import i18n from "@/i18n";
import type { DecideStatus } from "@/types/connection";
import { createMockConnection, createMockPod } from "@tests/helpers/factories";

function stubSvgPathGeometry(): void {
  const svgPathPrototype = Object.getPrototypeOf(
    document.createElementNS("http://www.w3.org/2000/svg", "path"),
  ) as SVGElement;
  const prototypes = [Element.prototype, SVGElement.prototype, svgPathPrototype];

  prototypes.forEach((prototype) => {
    Object.defineProperty(prototype, "getTotalLength", {
      configurable: true,
      value: () => 160,
    });

    Object.defineProperty(prototype, "getPointAtLength", {
      configurable: true,
      value: (distance: number) => ({ x: distance, y: 40 }),
    });
  });
}

function mountBranchConnection(
  decideStatus: DecideStatus,
  label: string,
  decideReason?: string,
): VueWrapper {
  const pinia = createPinia();
  setActivePinia(pinia);

  const sourcePod = createMockPod({ id: "pod-source", x: 100, y: 100 });
  const targetPod = createMockPod({ id: "pod-target", x: 420, y: 100 });
  const connection = createMockConnection({
    id: `conn-${decideStatus}`,
    sourcePodId: sourcePod.id,
    sourceAnchor: "right",
    targetPodId: targetPod.id,
    targetAnchor: "left",
    triggerMode: "branch",
    decideStatus,
    label,
    decideReason,
  });

  return mount(ConnectionLine, {
    props: {
      connection,
      podsById: new Map([
        [sourcePod.id, sourcePod],
        [targetPod.id, targetPod],
      ]),
      isSelected: false,
      status: "idle",
      triggerMode: "branch",
      decideStatus,
      label,
      decideReason,
    },
    global: {
      plugins: [pinia, i18n],
    },
  });
}

describe("connection line branch userflow", () => {
  beforeEach(() => {
    stubSvgPathGeometry();
  });

  it('尚未決策的 branch 連線顯示使用者 label，且不顯示保留字 "None"', () => {
    const wrapper = mountBranchConnection("none", "deploy-production");

    expect(wrapper.text()).toContain("deploy-production");
    expect(wrapper.text()).not.toContain("None");
    expect(wrapper.find(".connection-line").classes()).toContain("branch");
    expect(wrapper.find(".connection-line").classes()).not.toContain(
      "approved",
    );
    expect(wrapper.find(".connection-line").classes()).not.toContain(
      "rejected",
    );

    wrapper.unmount();
  });

  it("branch 決策後可從連線狀態分辨被選中與未被選中的 branch", () => {
    const approvedWrapper = mountBranchConnection(
      "approved",
      "release-train",
    );
    const rejectedWrapper = mountBranchConnection(
      "rejected",
      "rollback-plan",
      "branch 決策已選擇 release-train",
    );

    expect(approvedWrapper.text()).toContain("release-train");
    expect(rejectedWrapper.text()).toContain("rollback-plan");

    expect(approvedWrapper.find(".connection-line").classes()).toContain(
      "approved",
    );
    expect(approvedWrapper.find(".connection-line").classes()).not.toContain(
      "rejected",
    );
    expect(rejectedWrapper.find(".connection-line").classes()).toContain(
      "rejected",
    );
    expect(rejectedWrapper.find(".connection-line").classes()).not.toContain(
      "approved",
    );
    expect(rejectedWrapper.find("foreignObject").attributes("title")).toContain(
      "branch 決策已選擇 release-train",
    );

    approvedWrapper.unmount();
    rejectedWrapper.unmount();
  });

  it("branch 開啟 direct 時仍保留 branch label，並額外顯示 direct 標記", () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const sourcePod = createMockPod({ id: "pod-source", x: 100, y: 100 });
    const targetPod = createMockPod({ id: "pod-target", x: 420, y: 100 });
    const connection = createMockConnection({
      id: "conn-branch-direct",
      sourcePodId: sourcePod.id,
      sourceAnchor: "right",
      targetPodId: targetPod.id,
      targetAnchor: "left",
      triggerMode: "branch",
      decideStatus: "none",
      label: "release-train",
      direct: true,
    });

    const wrapper = mount(ConnectionLine, {
      props: {
        connection,
        podsById: new Map([
          [sourcePod.id, sourcePod],
          [targetPod.id, targetPod],
        ]),
        isSelected: false,
        status: "idle",
        triggerMode: "branch",
        decideStatus: "none",
        label: "release-train",
      },
      global: {
        plugins: [pinia, i18n],
      },
    });

    expect(wrapper.text()).toContain("release-train");
    expect(wrapper.find(".connection-line").classes()).toContain("direct");
    expect(wrapper.find(".connection-mid-label.direct-label").text()).toBe("D");

    wrapper.unmount();
  });
});
