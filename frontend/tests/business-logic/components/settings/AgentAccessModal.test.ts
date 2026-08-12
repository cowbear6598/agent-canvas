import { flushPromises, mount } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import AgentAccessModal from "@/components/settings/AgentAccessModal.vue";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

const getAgentAccessInfoMock = vi.fn();
const listAgentAccessTokensMock = vi.fn();
const createAgentAccessTokenMock = vi.fn();
const revokeAgentAccessTokenMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/services/agentAccessApi", () => ({
  createAgentAccessToken: (input: unknown) => createAgentAccessTokenMock(input),
  downloadAgentCanvasSkill: vi.fn(),
  getAgentAccessInfo: () => getAgentAccessInfoMock(),
  listAgentAccessTokens: () => listAgentAccessTokensMock(),
  revokeAgentAccessToken: (tokenId: string) =>
    revokeAgentAccessTokenMock(tokenId),
  updateAgentAccessSettings: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const dialogStub = defineComponent({
  props: { open: { type: Boolean, default: false } },
  emits: ["update:open"],
  template: '<div v-if="open"><slot /></div>',
});
const passthroughStub = { template: "<div><slot /></div>" };
const buttonStub = {
  props: ["disabled", "variant", "size"],
  emits: ["click"],
  template: `
    <button :disabled="disabled" @click="$emit('click', $event)">
      <slot />
    </button>
  `,
};
const inputStub = {
  props: ["modelValue", "readonly", "placeholder"],
  emits: ["update:modelValue"],
  template: `
    <input
      :value="modelValue"
      :readonly="readonly"
      :placeholder="placeholder"
      @input="$emit('update:modelValue', $event.target.value)"
    >
  `,
};

async function mountModal() {
  const wrapper = mount(AgentAccessModal, {
    props: { open: false },
    attachTo: document.body,
    global: {
      stubs: {
        Button: buttonStub,
        Dialog: dialogStub,
        DialogContent: passthroughStub,
        DialogDescription: passthroughStub,
        DialogFooter: passthroughStub,
        DialogHeader: passthroughStub,
        DialogTitle: passthroughStub,
        Input: inputStub,
        Label: passthroughStub,
        ModalBackButton: true,
        ScrollArea: passthroughStub,
      },
    },
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

describe("AgentAccessModal", () => {
  const clipboardWriteTextMock = vi.fn();
  const execCommandMock = vi.fn();

  beforeEach(() => {
    setActivePinia(setupTestPinia());
    vi.clearAllMocks();
    getAgentAccessInfoMock.mockResolvedValue({
      apiBaseUrl: "http://192.168.1.20:3000",
      defaultApiBaseUrl: "http://192.168.1.20:3000",
      advertisedUrl: null,
    });
    listAgentAccessTokensMock.mockResolvedValue({
      tokens: [
        {
          id: "token-1",
          name: "My token",
          tokenHint: "acv1_…123456",
          scopes: ["canvas:read", "canvas:execute"],
          canvasIds: [],
          expiresAt: null,
          createdAt: "2026-08-12T00:00:00.000Z",
          revokedAt: null,
        },
      ],
      canvases: [
        {
          id: "canvas-1",
          name: "Canvas 1",
          isProtected: false,
        },
      ],
    });
    revokeAgentAccessTokenMock.mockResolvedValue(undefined);
    createAgentAccessTokenMock.mockResolvedValue({
      token: "acv1_example_token",
      record: {
        id: "token-2",
        name: "New token",
        tokenHint: "acv1_…token",
        scopes: [],
        canvasIds: [],
        expiresAt: null,
        createdAt: "2026-08-12T00:00:00.000Z",
        revokedAt: null,
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteTextMock },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommandMock,
    });
  });

  it("以原始 canvas:* 格式顯示權限", async () => {
    const wrapper = await mountModal();

    expect(wrapper.text()).toContain("canvas:read");
    expect(wrapper.text()).toContain("canvas:execute");
    expect(wrapper.text()).not.toContain("讀取 Canvas");
  });

  it("Clipboard API 失敗時使用 execCommand fallback 並顯示成功狀態", async () => {
    clipboardWriteTextMock.mockRejectedValue(new Error("denied"));
    execCommandMock.mockReturnValue(true);
    const wrapper = await mountModal();

    await wrapper.get("[data-testid='agent-access-copy-base-url']").trigger("click");
    await flushPromises();

    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      "http://192.168.1.20:3000",
    );
    expect(execCommandMock).toHaveBeenCalledWith("copy");
    expect(wrapper.get("[data-testid='agent-access-copy-base-url']").text()).toBe(
      "複製成功",
    );
  });

  it("完整連線設定使用 Skill 宣告的環境變數名稱", async () => {
    clipboardWriteTextMock.mockResolvedValue(undefined);
    const wrapper = await mountModal();
    const nameInput = wrapper.get("[data-testid='agent-access-token-name']");
    await nameInput.setValue("New token");
    const checkboxes = wrapper.findAll("input[type='checkbox']");
    await checkboxes[0]!.setValue(true);
    await checkboxes[4]!.setValue(true);
    await wrapper.get("[data-testid='agent-access-create-token']").trigger("click");
    await flushPromises();

    await wrapper
      .get("[data-testid='agent-access-copy-connection']")
      .trigger("click");
    await flushPromises();

    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      'AGENT_CANVAS_BASE_URL="http://192.168.1.20:3000"\n' +
        'AGENT_CANVAS_TOKEN="acv1_example_token"',
    );
  });

  it("名稱、權限與 Canvas 都有值時才允許建立 Token", async () => {
    const wrapper = await mountModal();
    const createButton = wrapper.get(
      "[data-testid='agent-access-create-token']",
    );

    expect(createButton.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("請至少選擇一個權限");
    expect(wrapper.text()).toContain("請至少選擇一個 Canvas");

    await wrapper
      .get("[data-testid='agent-access-token-name']")
      .setValue("Valid token");
    const checkboxes = wrapper.findAll("input[type='checkbox']");
    await checkboxes[0]!.setValue(true);
    expect(createButton.attributes("disabled")).toBeDefined();

    await checkboxes[4]!.setValue(true);
    expect(createButton.attributes("disabled")).toBeUndefined();
  });

  it("撤銷前要求二次確認，成功後立即從清單移除", async () => {
    const wrapper = await mountModal();

    await wrapper.get("[data-testid='agent-access-revoke-token-1']").trigger("click");
    expect(revokeAgentAccessTokenMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("確認撤銷 Token？");

    await wrapper.get("[data-testid='agent-access-confirm-revoke']").trigger("click");
    await flushPromises();

    expect(revokeAgentAccessTokenMock).toHaveBeenCalledWith("token-1");
    expect(wrapper.text()).not.toContain("My token");
    expect(toastMock).toHaveBeenCalledWith({ title: "Token 已撤銷" });
  });
});
