import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionLine from "@/components/canvas/ConnectionLine.vue";
import { useConnectionStore } from "@/stores/connectionStore";
import { useViewportStore } from "@/stores/pod";
import { createMockConnection, createMockPod } from "@tests/helpers/factories";

describe("connection routing point userflow", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("拖曳直角折線的新增把手後會建立路徑節點並在 mouseup 保存", async () => {
    const connectionStore = useConnectionStore();
    const viewportStore = useViewportStore();
    viewportStore.zoom = 2;

    const connection = createMockConnection({
      id: "conn-routing",
      sourcePodId: "source",
      sourceAnchor: "right",
      targetPodId: "target",
      targetAnchor: "left",
      routingMode: "orthogonal",
      routingOffset: 0,
    });
    const updateSpy = vi
      .spyOn(connectionStore, "updateConnectionRouting")
      .mockResolvedValue(connection);
    const podsById = new Map([
      ["source", createMockPod({ id: "source", x: 0, y: 100 })],
      ["target", createMockPod({ id: "target", x: 500, y: 100 })],
    ]);

    const wrapper = mount(ConnectionLine, {
      props: {
        connection,
        podsById,
        isSelected: true,
      },
    });
    const handle = wrapper.find('[data-testid="connection-route-insert-0"]');
    expect(handle.exists()).toBe(true);
    const originX = Number(handle.find("circle").attributes("cx"));
    const originY = Number(handle.find("circle").attributes("cy"));

    await handle.trigger("mousedown", { clientX: 300, clientY: 200 });
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 300, clientY: 120 }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith("conn-routing", {
      routingOffset: 0,
      routingPoints: [
        { x: originX, y: originY - 40, orthogonalRole: "lane" },
      ],
    });
    wrapper.unmount();
  });

  it("拖曳直角側邊控制點會保留原本的通道 offset", async () => {
    const connectionStore = useConnectionStore();
    const connection = createMockConnection({
      id: "conn-side-routing",
      sourcePodId: "source",
      sourceAnchor: "right",
      targetPodId: "target",
      targetAnchor: "left",
      routingMode: "orthogonal",
      routingOffset: -100,
    });
    const updateSpy = vi
      .spyOn(connectionStore, "updateConnectionRouting")
      .mockResolvedValue(connection);
    const podsById = new Map([
      ["source", createMockPod({ id: "source", x: 0, y: 100 })],
      ["target", createMockPod({ id: "target", x: 500, y: 100 })],
    ]);
    const wrapper = mount(ConnectionLine, {
      props: { connection, podsById, isSelected: true },
    });
    const handle = wrapper.find(
      '[data-testid="connection-route-insert-0"] circle',
    );
    const originX = Number(handle.attributes("cx"));
    const originY = Number(handle.attributes("cy"));

    await handle.trigger("mousedown", {
      clientX: originX,
      clientY: originY,
    });
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: originX - 30,
        clientY: originY + 60,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith("conn-side-routing", {
      routingOffset: -100,
      routingPoints: [
        {
          x: originX - 30,
          y: originY,
          orthogonalRole: "source-leg",
        },
      ],
    });
    wrapper.unmount();
  });

  it("拖曳 Bezier 新增把手後會建立可自由移動的路徑節點", async () => {
    const connectionStore = useConnectionStore();
    const connection = createMockConnection({ routingMode: "bezier" });
    const podsById = new Map([
      [
        connection.sourcePodId!,
        createMockPod({ id: connection.sourcePodId, x: 0, y: 0 }),
      ],
      [
        connection.targetPodId,
        createMockPod({ id: connection.targetPodId, x: 400, y: 0 }),
      ],
    ]);
    const wrapper = mount(ConnectionLine, {
      props: { connection, podsById, isSelected: true },
    });

    const updateSpy = vi
      .spyOn(connectionStore, "updateConnectionRouting")
      .mockResolvedValue(connection);
    const handle = wrapper.find('[data-testid="connection-route-insert-0"]');
    expect(handle.exists()).toBe(true);
    const originX = Number(handle.find("circle").attributes("cx"));
    const originY = Number(handle.find("circle").attributes("cy"));

    await handle.trigger("mousedown", { clientX: 200, clientY: 100 });
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 200, clientY: 40 }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith(connection.id, {
      routingOffset: 0,
      routingPoints: [{ x: originX, y: originY - 60 }],
    });
    wrapper.unmount();
  });

  it("既有路徑節點可自由拖曳", async () => {
    const connectionStore = useConnectionStore();
    const connection = createMockConnection({
      routingMode: "bezier",
      routingPoints: [{ x: 250, y: 80 }],
    });
    const updateSpy = vi
      .spyOn(connectionStore, "updateConnectionRouting")
      .mockResolvedValue(connection);
    const podsById = new Map([
      [
        connection.sourcePodId!,
        createMockPod({ id: connection.sourcePodId, x: 0, y: 0 }),
      ],
      [
        connection.targetPodId,
        createMockPod({ id: connection.targetPodId, x: 400, y: 0 }),
      ],
    ]);
    const wrapper = mount(ConnectionLine, {
      props: { connection, podsById, isSelected: true },
    });

    const handle = wrapper.find('[data-testid="connection-route-point-0"]');
    await handle.trigger("mousedown", { clientX: 250, clientY: 80 });
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 290, clientY: 120 }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith(connection.id, {
      routingOffset: 0,
      routingPoints: [{ x: 290, y: 120 }],
    });
    wrapper.unmount();
  });

  it("直角既有控制點依角色限制軸向並保留角色", async () => {
    const connectionStore = useConnectionStore();
    const connection = createMockConnection({
      routingMode: "orthogonal",
      routingPoints: [
        { x: 250, y: 20, orthogonalRole: "lane" },
        { x: 430, y: 80, orthogonalRole: "target-leg" },
      ],
    });
    const updateSpy = vi
      .spyOn(connectionStore, "updateConnectionRouting")
      .mockResolvedValue(connection);
    const podsById = new Map([
      [
        connection.sourcePodId!,
        createMockPod({ id: connection.sourcePodId, x: 0, y: 100 }),
      ],
      [
        connection.targetPodId,
        createMockPod({ id: connection.targetPodId, x: 500, y: 100 }),
      ],
    ]);
    const wrapper = mount(ConnectionLine, {
      props: { connection, podsById, isSelected: true },
    });
    const laneHandle = wrapper.find(
      '[data-testid="connection-route-point-0"] circle',
    );
    const targetHandle = wrapper.find(
      '[data-testid="connection-route-point-1"] circle',
    );
    const laneX = Number(laneHandle.attributes("cx"));
    const laneY = Number(laneHandle.attributes("cy"));
    const targetX = Number(targetHandle.attributes("cx"));
    const targetY = Number(targetHandle.attributes("cy"));

    await targetHandle.trigger("mousedown", {
      clientX: targetX,
      clientY: targetY,
    });
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: targetX + 40,
        clientY: targetY + 80,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith(connection.id, {
      routingOffset: 0,
      routingPoints: [
        { x: laneX, y: laneY, orthogonalRole: "lane" },
        {
          x: targetX + 40,
          y: targetY,
          orthogonalRole: "target-leg",
        },
      ],
    });
    wrapper.unmount();
  });

  it("三個路徑節點時不再顯示新增把手", () => {
    const connection = createMockConnection({
      routingMode: "orthogonal",
      routingPoints: [
        { x: 150, y: 50 },
        { x: 250, y: 100 },
        { x: 350, y: 50 },
      ],
    });
    const podsById = new Map([
      [
        connection.sourcePodId!,
        createMockPod({ id: connection.sourcePodId, x: 0, y: 0 }),
      ],
      [
        connection.targetPodId,
        createMockPod({ id: connection.targetPodId, x: 400, y: 0 }),
      ],
    ]);
    const wrapper = mount(ConnectionLine, {
      props: { connection, podsById, isSelected: true },
    });

    expect(wrapper.findAll('[data-testid^="connection-route-point-"]')).toHaveLength(3);
    expect(wrapper.find('[data-testid^="connection-route-insert-"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("Branch label 應繪製在路徑調節點後方", () => {
    const connection = createMockConnection();
    const podsById = new Map([
      [
        connection.sourcePodId!,
        createMockPod({ id: connection.sourcePodId, x: 0, y: 0 }),
      ],
      [
        connection.targetPodId,
        createMockPod({ id: connection.targetPodId, x: 400, y: 0 }),
      ],
    ]);
    const wrapper = mount(ConnectionLine, {
      props: {
        connection,
        podsById,
        isSelected: true,
        triggerMode: "branch",
        label: "fail",
      },
    });

    const label = wrapper.find("foreignObject").element;
    const handle = wrapper.find('[data-testid="connection-route-insert-0"]').element;

    expect(
      label.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    wrapper.unmount();
  });
});
