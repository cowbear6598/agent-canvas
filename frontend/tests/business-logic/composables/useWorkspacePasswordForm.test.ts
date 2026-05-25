import { describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { useWorkspacePasswordForm } from "@/composables/useWorkspacePasswordForm";

function createStore() {
  return reactive({
    workspacePasswordEnabled: false,
    isPasswordTransportBlocked: false,
  });
}

describe("useWorkspacePasswordForm", () => {
  it("設定 workspace 密碼成功後應更新 store、顯示 toast 並清空表單", async () => {
    const securityStore = createStore();
    const updateWorkspacePassword = vi.fn(async () => ({
      requestId: "request-1",
      success: true,
      hasWorkspacePassword: true,
    }));
    const showSuccessToast = vi.fn();
    const form = useWorkspacePasswordForm({
      securityStore,
      t: (key) => key,
      showSuccessToast,
      updateWorkspacePassword,
    });
    form.workspaceNewPassword.value = "new-password";

    await form.handleSetWorkspacePassword();

    expect(updateWorkspacePassword).toHaveBeenCalledWith({
      action: "set",
      newPassword: "new-password",
    });
    expect(securityStore.workspacePasswordEnabled).toBe(true);
    expect(showSuccessToast).toHaveBeenCalledWith(
      "Workspace",
      "security.workspace.saved",
    );
    expect(form.workspaceNewPassword.value).toBe("");
    expect(form.workspaceSecurityError.value).toBeNull();
  });

  it("變更 workspace 密碼應送出目前密碼與新密碼", async () => {
    const securityStore = createStore();
    securityStore.workspacePasswordEnabled = true;
    const updateWorkspacePassword = vi.fn(async () => ({
      requestId: "request-1",
      success: true,
      hasWorkspacePassword: true,
    }));
    const form = useWorkspacePasswordForm({
      securityStore,
      t: (key) => key,
      showSuccessToast: vi.fn(),
      updateWorkspacePassword,
    });
    form.workspaceCurrentPassword.value = "current-password";
    form.workspaceNewPassword.value = "new-password";

    await form.handleChangeWorkspacePassword();

    expect(updateWorkspacePassword).toHaveBeenCalledWith({
      action: "change",
      currentPassword: "current-password",
      newPassword: "new-password",
    });
    expect(securityStore.workspacePasswordEnabled).toBe(true);
  });

  it("移除 workspace 密碼成功後應關閉密碼狀態", async () => {
    const securityStore = createStore();
    securityStore.workspacePasswordEnabled = true;
    const updateWorkspacePassword = vi.fn(async () => ({
      requestId: "request-1",
      success: true,
      hasWorkspacePassword: false,
    }));
    const form = useWorkspacePasswordForm({
      securityStore,
      t: (key) => key,
      showSuccessToast: vi.fn(),
      updateWorkspacePassword,
    });
    form.workspaceCurrentPassword.value = "current-password";

    await form.handleRemoveWorkspacePassword();

    expect(updateWorkspacePassword).toHaveBeenCalledWith({
      action: "remove",
      currentPassword: "current-password",
    });
    expect(securityStore.workspacePasswordEnabled).toBe(false);
  });

  it("API 失敗時應保留密碼欄位並顯示錯誤", async () => {
    const securityStore = createStore();
    const updateWorkspacePassword = vi.fn(async () => {
      throw new Error("password rejected");
    });
    const form = useWorkspacePasswordForm({
      securityStore,
      t: (key) => key,
      showSuccessToast: vi.fn(),
      updateWorkspacePassword,
    });
    form.workspaceNewPassword.value = "new-password";

    await form.handleSetWorkspacePassword();

    expect(form.workspaceNewPassword.value).toBe("new-password");
    expect(form.workspaceSecurityError.value).toBe("password rejected");
    expect(form.isUpdatingWorkspacePassword.value).toBe(false);
  });

  it("transport 被阻擋或欄位空白時應停用動作", () => {
    const securityStore = createStore();
    const form = useWorkspacePasswordForm({
      securityStore,
      t: (key) => key,
      showSuccessToast: vi.fn(),
      updateWorkspacePassword: vi.fn(),
    });

    expect(form.canSetWorkspacePassword.value).toBe(false);

    form.workspaceNewPassword.value = "new-password";
    expect(form.canSetWorkspacePassword.value).toBe(true);

    securityStore.isPasswordTransportBlocked = true;
    expect(form.canSetWorkspacePassword.value).toBe(false);
  });
});
