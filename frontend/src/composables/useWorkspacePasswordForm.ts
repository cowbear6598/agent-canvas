import { computed, ref, type ComputedRef, type Ref } from "vue";
import { updateWorkspacePassword as updateWorkspacePasswordApi } from "@/services/securityApi";
import type { ToastCategory } from "@/composables/useToast";

interface WorkspaceSecurityStoreLike {
  workspacePasswordEnabled: boolean;
  isPasswordTransportBlocked: boolean;
}

interface UseWorkspacePasswordFormOptions {
  securityStore: WorkspaceSecurityStoreLike;
  t: (key: string) => string;
  showSuccessToast: (
    category: ToastCategory,
    action: string,
    target?: string,
  ) => string;
  updateWorkspacePassword?: typeof updateWorkspacePasswordApi;
}

interface WorkspacePasswordForm {
  workspaceCurrentPassword: Ref<string>;
  workspaceNewPassword: Ref<string>;
  workspaceSecurityError: Ref<string | null>;
  isUpdatingWorkspacePassword: Ref<boolean>;
  canSetWorkspacePassword: ComputedRef<boolean>;
  canRemoveWorkspacePassword: ComputedRef<boolean>;
  canChangeWorkspacePassword: ComputedRef<boolean>;
  resetWorkspaceSecurityForm: () => void;
  handleSetWorkspacePassword: () => Promise<void>;
  handleChangeWorkspacePassword: () => Promise<void>;
  handleRemoveWorkspacePassword: () => Promise<void>;
}

export function useWorkspacePasswordForm({
  securityStore,
  t,
  showSuccessToast,
  updateWorkspacePassword = updateWorkspacePasswordApi,
}: UseWorkspacePasswordFormOptions): WorkspacePasswordForm {
  const workspaceCurrentPassword = ref<string>("");
  const workspaceNewPassword = ref<string>("");
  const workspaceSecurityError = ref<string | null>(null);
  const isUpdatingWorkspacePassword = ref<boolean>(false);

  const canSetWorkspacePassword = computed<boolean>(
    () =>
      !isUpdatingWorkspacePassword.value &&
      !securityStore.isPasswordTransportBlocked &&
      workspaceNewPassword.value.trim() !== "",
  );
  const canRemoveWorkspacePassword = computed<boolean>(
    () =>
      !isUpdatingWorkspacePassword.value &&
      !securityStore.isPasswordTransportBlocked &&
      workspaceCurrentPassword.value.trim() !== "",
  );
  const canChangeWorkspacePassword = computed<boolean>(
    () =>
      !isUpdatingWorkspacePassword.value &&
      !securityStore.isPasswordTransportBlocked &&
      workspaceCurrentPassword.value.trim() !== "" &&
      workspaceNewPassword.value.trim() !== "",
  );

  const resetWorkspaceSecurityForm = (): void => {
    workspaceCurrentPassword.value = "";
    workspaceNewPassword.value = "";
    workspaceSecurityError.value = null;
  };

  const runWorkspacePasswordUpdate = async (
    request: Parameters<typeof updateWorkspacePassword>[0],
    successMessage: string,
    fallbackEnabled: boolean,
  ): Promise<void> => {
    isUpdatingWorkspacePassword.value = true;
    workspaceSecurityError.value = null;

    try {
      const result = await updateWorkspacePassword(request);
      securityStore.workspacePasswordEnabled =
        result.hasWorkspacePassword ?? fallbackEnabled;
      showSuccessToast("Workspace", successMessage);
      resetWorkspaceSecurityForm();
    } catch (error) {
      workspaceSecurityError.value =
        error instanceof Error ? error.message : t("settings.saveFailed");
    } finally {
      isUpdatingWorkspacePassword.value = false;
    }
  };

  const handleSetWorkspacePassword = async (): Promise<void> => {
    if (!workspaceNewPassword.value.trim()) {
      return;
    }

    await runWorkspacePasswordUpdate(
      {
        action: "set",
        newPassword: workspaceNewPassword.value,
      },
      t("security.workspace.saved"),
      true,
    );
  };

  const handleChangeWorkspacePassword = async (): Promise<void> => {
    if (
      !workspaceCurrentPassword.value.trim() ||
      !workspaceNewPassword.value.trim()
    ) {
      return;
    }

    await runWorkspacePasswordUpdate(
      {
        action: "change",
        currentPassword: workspaceCurrentPassword.value,
        newPassword: workspaceNewPassword.value,
      },
      t("security.workspace.updated"),
      true,
    );
  };

  const handleRemoveWorkspacePassword = async (): Promise<void> => {
    if (!workspaceCurrentPassword.value.trim()) {
      return;
    }

    await runWorkspacePasswordUpdate(
      {
        action: "remove",
        currentPassword: workspaceCurrentPassword.value,
      },
      t("security.workspace.removed"),
      false,
    );
  };

  return {
    workspaceCurrentPassword,
    workspaceNewPassword,
    workspaceSecurityError,
    isUpdatingWorkspacePassword,
    canSetWorkspacePassword,
    canRemoveWorkspacePassword,
    canChangeWorkspacePassword,
    resetWorkspaceSecurityForm,
    handleSetWorkspacePassword,
    handleChangeWorkspacePassword,
    handleRemoveWorkspacePassword,
  };
}
