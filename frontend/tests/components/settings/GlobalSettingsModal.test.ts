import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useConfigStore } from "@/stores/configStore";
import GlobalSettingsModal from "@/components/settings/GlobalSettingsModal.vue";

// ── WS 邊界 mock ─────────────────────────────────────────────────
// backupApi 使用深路徑 @/services/websocket/createWebSocketRequest，需兩個路徑都 mock
vi.mock("@/services/websocket", () => webSocketMockFactory());
vi.mock("@/services/websocket/createWebSocketRequest", async () => {
  const { mockCreateWebSocketRequest: fn } =
    await import("../../helpers/mockWebSocket");
  return { createWebSocketRequest: fn };
});

// ── configApi：service 邊界，合理保留 ────────────────────────────
const { mockGetConfig, mockUpdateConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockUpdateConfig: vi.fn(),
}));
vi.mock("@/services/configApi", () => ({
  getConfig: mockGetConfig,
  updateConfig: mockUpdateConfig,
}));

// ── UI 元件 mock（避免複雜子元件 render 干擾）────────────────────
vi.mock("@/components/ui/dialog", () => ({
  Dialog: {
    name: "Dialog",
    props: ["open"],
    emits: ["update:open"],
    template: '<div v-if="open"><slot /></div>',
  },
  DialogContent: { name: "DialogContent", template: "<div><slot /></div>" },
  DialogHeader: { name: "DialogHeader", template: "<div><slot /></div>" },
  DialogTitle: { name: "DialogTitle", template: "<div><slot /></div>" },
  DialogDescription: {
    name: "DialogDescription",
    template: "<div><slot /></div>",
  },
  DialogFooter: { name: "DialogFooter", template: "<div><slot /></div>" },
}));

vi.mock("@/components/ui/button", () => ({
  Button: {
    name: "Button",
    props: ["disabled"],
    emits: ["click"],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
}));

vi.mock("@/components/ui/label", () => ({
  Label: { name: "Label", template: "<label><slot /></label>" },
}));

vi.mock("@/components/ui/select", () => ({
  Select: {
    name: "Select",
    props: ["modelValue", "disabled"],
    emits: ["update:modelValue"],
    template:
      '<div class="select-mock" :data-value="modelValue"><slot /></div>',
  },
  SelectTrigger: { name: "SelectTrigger", template: "<div><slot /></div>" },
  SelectValue: {
    name: "SelectValue",
    props: ["placeholder"],
    template: "<span></span>",
  },
  SelectContent: { name: "SelectContent", template: "<div><slot /></div>" },
  SelectItem: {
    name: "SelectItem",
    props: ["value"],
    template: '<div :data-value="value"><slot /></div>',
  },
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: {
    name: "Switch",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template:
      '<button class="switch-mock" :data-checked="modelValue" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
  },
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: { name: "ScrollArea", template: "<div><slot /></div>" },
}));

vi.mock("@/components/ui/input", () => ({
  Input: {
    name: "Input",
    props: ["modelValue", "placeholder", "disabled"],
    emits: ["update:modelValue"],
    template:
      '<input class="input-mock" :value="modelValue" :placeholder="placeholder" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
}));

// ── 輔助函式 ─────────────────────────────────────────────────────

/** 掛載元件並等待 getConfig 非同步載入完成（大多數 case 的共用模式） */
async function mountAndLoad(
  configResponse: Record<string, unknown> = {
    success: true,
    aiDecideModel: "sonnet",
  },
) {
  mockGetConfig.mockResolvedValue(configResponse);
  const wrapper = mount(GlobalSettingsModal, { props: { open: true } });
  await nextTick();
  await nextTick();
  return wrapper;
}

/** 找儲存按鈕 */
function findSaveBtn(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll("button").find((b) => b.text().includes("儲存"))!;
}

describe("GlobalSettingsModal", () => {
  // 使用真實 configStore + Pinia，不 mock store / useToast / useWebSocketErrorHandler
  setupStoreTest();

  describe("載入設定", () => {
    it("開啟時應呼叫 configApi.getConfig 載入目前設定", async () => {
      const wrapper = await mountAndLoad({
        success: true,
        aiDecideModel: "haiku",
      });
      expect(mockGetConfig).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it("載入設定後應以伺服器回傳的 timezoneOffset 更新時區選單", async () => {
      const wrapper = await mountAndLoad({
        success: true,
        aiDecideModel: "sonnet",
        timezoneOffset: 9,
      });
      // index 0 為時區 Select
      expect(wrapper.findAll(".select-mock")[0]?.attributes("data-value")).toBe(
        "9",
      );
      wrapper.unmount();
    });

    it("載入設定後應正確顯示備份設定值（URL / Switch）", async () => {
      const wrapper = await mountAndLoad({
        success: true,
        aiDecideModel: "sonnet",
        backupGitRemoteUrl: "git@github.com:test/repo.git",
        backupTime: "04:30",
        backupEnabled: true,
      });
      expect(wrapper.find(".input-mock").attributes("value")).toBe(
        "git@github.com:test/repo.git",
      );
      expect(
        wrapper.findComponent({ name: "Switch" }).props("modelValue"),
      ).toBe(true);
      wrapper.unmount();
    });
  });

  describe("儲存設定", () => {
    it("點擊儲存應發送包含 timezoneOffset 與備份設定的完整 payload", async () => {
      const wrapper = await mountAndLoad({
        success: true,
        aiDecideModel: "sonnet",
        timezoneOffset: 8,
        backupGitRemoteUrl: "git@github.com:test/backup.git",
        backupTime: "03:00",
        backupEnabled: true,
      });
      mockUpdateConfig.mockResolvedValue({ success: true });

      await findSaveBtn(wrapper).trigger("click");
      await nextTick();

      expect(mockUpdateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          timezoneOffset: 8,
          backupGitRemoteUrl: "git@github.com:test/backup.git",
          backupTime: "03:00",
          backupEnabled: true,
        }),
      );
      wrapper.unmount();
    });

    it("備份關閉時儲存，送出的 backupGitRemoteUrl 應為空字串", async () => {
      const wrapper = await mountAndLoad({
        success: true,
        aiDecideModel: "sonnet",
        backupEnabled: false,
        backupGitRemoteUrl: "git@github.com:test/backup.git",
      });
      mockUpdateConfig.mockResolvedValue({ success: true });

      await findSaveBtn(wrapper).trigger("click");
      await flushPromises();

      expect(mockUpdateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ backupGitRemoteUrl: "" }),
      );
      wrapper.unmount();
    });

    it("儲存成功後應 emit update:open=false", async () => {
      const wrapper = await mountAndLoad();
      mockUpdateConfig.mockResolvedValue({ success: true });

      await findSaveBtn(wrapper).trigger("click");
      await flushPromises();

      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
      wrapper.unmount();
    });

    it("儲存失敗時不應關閉 Modal 且儲存按鈕可再次點擊", async () => {
      const wrapper = await mountAndLoad();
      // updateConfig reject → withErrorToast 吸收錯誤回傳 null → handleSave 不執行關閉
      mockUpdateConfig.mockRejectedValue(new Error("伺服器錯誤"));

      const button = findSaveBtn(wrapper);
      await button.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("update:open")).toBeFalsy();
      expect(button.attributes("disabled")).toBeUndefined();
      wrapper.unmount();
    });
  });

  describe("按鈕 disabled 狀態", () => {
    it("載入中應禁用儲存按鈕", async () => {
      let resolveGetConfig!: (value: unknown) => void;
      mockGetConfig.mockReturnValue(
        new Promise((resolve) => {
          resolveGetConfig = resolve;
        }),
      );

      const wrapper = mount(GlobalSettingsModal, { props: { open: true } });
      await nextTick();

      expect(findSaveBtn(wrapper).attributes("disabled")).toBeDefined();

      resolveGetConfig({ success: true, aiDecideModel: "sonnet" });
      await flushPromises();
      wrapper.unmount();
    });

    it("儲存中應禁用儲存按鈕並顯示「儲存中」文字", async () => {
      const wrapper = await mountAndLoad();
      let resolveUpdate!: (value: unknown) => void;
      mockUpdateConfig.mockReturnValue(
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
      );

      const button = findSaveBtn(wrapper);
      await button.trigger("click");
      await nextTick();

      expect(button.attributes("disabled")).toBeDefined();
      expect(button.text()).toContain("儲存中");

      resolveUpdate({ success: true });
      await flushPromises();
      wrapper.unmount();
    });

    it.each([
      ["備份開關關閉", false, "git@github.com:test/repo.git"],
      ["Git Remote URL 為空", true, ""],
    ])(
      "%s 時「立即備份」按鈕應被禁用",
      async (_label, backupEnabled, backupGitRemoteUrl) => {
        const wrapper = await mountAndLoad({
          success: true,
          aiDecideModel: "sonnet",
          backupEnabled,
          backupGitRemoteUrl,
        });
        const backupBtn = wrapper
          .findAll("button")
          .find((b) => b.text().includes("立即備份"));
        expect(backupBtn?.attributes("disabled")).toBeDefined();
        wrapper.unmount();
      },
    );

    it("備份開關關閉時 Git Remote URL 輸入框與時間選擇器應被禁用", async () => {
      const wrapper = await mountAndLoad({
        success: true,
        aiDecideModel: "sonnet",
        backupEnabled: false,
      });
      expect(wrapper.find(".input-mock").attributes("disabled")).toBeDefined();
      const selects = wrapper.findAllComponents({ name: "Select" });
      // index 1 = backupHour, index 2 = backupMinute
      expect(selects[1]?.props("disabled")).toBe(true);
      expect(selects[2]?.props("disabled")).toBe(true);
      wrapper.unmount();
    });
  });

  describe("備份 UX 流程", () => {
    it("點擊「立即備份」應呼叫 triggerBackup（透過 WS）", async () => {
      const wrapper = await mountAndLoad({
        success: true,
        aiDecideModel: "sonnet",
        backupEnabled: true,
        backupGitRemoteUrl: "git@github.com:test/backup.git",
      });
      // createWebSocketRequest 對應 triggerBackup 的 WS 請求
      mockCreateWebSocketRequest.mockResolvedValue({ success: true });

      const backupBtn = wrapper
        .findAll("button")
        .find((b) => b.text().includes("立即備份"));
      await backupBtn?.trigger("click");
      await flushPromises();

      expect(mockCreateWebSocketRequest).toHaveBeenCalled();
      wrapper.unmount();
    });

    it("configStore.backupStatus 為 running 時，應顯示「備份中...」並禁用按鈕", async () => {
      const wrapper = await mountAndLoad({
        success: true,
        aiDecideModel: "sonnet",
        backupEnabled: true,
        backupGitRemoteUrl: "git@github.com:test/backup.git",
      });

      const configStore = useConfigStore();
      configStore.setBackupStatus("running");
      await nextTick();

      const runningBtn = wrapper
        .findAll("button")
        .find((b) => b.text().includes("備份中..."));
      expect(runningBtn).toBeDefined();
      expect(runningBtn?.attributes("disabled")).toBeDefined();

      configStore.setBackupStatus("idle");
      await nextTick();
      wrapper.unmount();
    });

    it("configStore.backupStatus 變成 failed 時，應顯示 inline 錯誤訊息", async () => {
      const wrapper = await mountAndLoad({
        success: true,
        aiDecideModel: "sonnet",
        backupEnabled: true,
        backupGitRemoteUrl: "git@github.com:test/backup.git",
      });

      const configStore = useConfigStore();
      configStore.setBackupStatus("failed", "備份推送失敗");
      await nextTick();
      await nextTick();

      expect(wrapper.text()).toContain("備份推送失敗");
      wrapper.unmount();
    });

    it("backupStatus 從 failed 變成 running 時，應清除 inline 錯誤訊息", async () => {
      const wrapper = await mountAndLoad({
        success: true,
        aiDecideModel: "sonnet",
        backupEnabled: true,
        backupGitRemoteUrl: "git@github.com:test/backup.git",
      });

      const configStore = useConfigStore();
      configStore.setBackupStatus("failed", "舊的錯誤訊息");
      await nextTick();
      await nextTick();
      expect(wrapper.text()).toContain("舊的錯誤訊息");

      configStore.setBackupStatus("running");
      await nextTick();
      await nextTick();
      expect(wrapper.text()).not.toContain("舊的錯誤訊息");
      wrapper.unmount();
    });

    it("應顯示上次備份時間（來自 configStore.lastBackupTime）", async () => {
      const wrapper = await mountAndLoad();
      const configStore = useConfigStore();
      configStore.setLastBackupTime("2026-03-26T03:00:00Z");
      await nextTick();
      expect(wrapper.text()).toContain("2026-03-26T03:00:00Z");
      wrapper.unmount();
    });
  });

  describe("備份欄位驗證（UX）", () => {
    it("備份開啟且 Git Remote URL 為空時，點擊儲存應顯示 inline 錯誤且不送出請求", async () => {
      const wrapper = await mountAndLoad({
        success: true,
        aiDecideModel: "sonnet",
        backupEnabled: true,
        backupGitRemoteUrl: "",
      });

      await findSaveBtn(wrapper).trigger("click");
      await nextTick();

      expect(wrapper.text()).toContain("請填寫 Git Remote URL");
      expect(mockUpdateConfig).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("備份關閉時即使 Git Remote URL 為空，點擊儲存也應正常送出", async () => {
      const wrapper = await mountAndLoad({
        success: true,
        aiDecideModel: "sonnet",
        backupEnabled: false,
        backupGitRemoteUrl: "",
      });
      mockUpdateConfig.mockResolvedValue({ success: true });

      await findSaveBtn(wrapper).trigger("click");
      await nextTick();

      expect(mockUpdateConfig).toHaveBeenCalled();
      wrapper.unmount();
    });
  });
});
