import { ref, type Ref } from "vue";
import { generateUUID } from "@/services/utils";
import { DEFAULT_TOAST_DURATION_MS } from "@/lib/constants";

type ToastVariant = "default" | "destructive" | "success";

const MAX_DESCRIPTION_LENGTH = 200;

export type ToastCategory =
  | "Pod"
  | "Skill"
  | "Repository"
  | "Canvas"
  | "Workspace"
  | "SubAgent"
  | "Workflow"
  | "Git"
  | "Command"
  | "Note"
  | "Schedule"
  | "Paste"
  | "WebSocket"
  | "McpServer"
  | "Connection"
  | "Slack"
  | "Telegram"
  | "Config"
  | "Jira"
  | "Integration";

interface ToastOptions {
  title: string;
  description?: string;
  duration?: number;
  variant?: ToastVariant;
}

interface ToastItem extends ToastOptions {
  id: string;
}

const toasts = ref<ToastItem[]>([]);

function limitDescriptionLength(
  description: string | undefined,
): string | undefined {
  if (!description) return description;

  if (description.length <= MAX_DESCRIPTION_LENGTH) {
    return description;
  }

  return description.substring(0, MAX_DESCRIPTION_LENGTH) + "...";
}

function createDescription(action: string, detail?: string): string {
  return detail ? `${action} - ${detail}` : action;
}

export function useToast(): {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  toasts: Ref<ToastItem[]>;
  showSuccessToast: (
    category: ToastCategory,
    action: string,
    target?: string,
  ) => string;
  showErrorToast: (
    category: ToastCategory,
    action: string,
    reason?: string,
  ) => string;
} {
  const toast = ({
    title,
    description,
    duration = DEFAULT_TOAST_DURATION_MS,
    variant = "default",
  }: ToastOptions): string => {
    const id = generateUUID();
    const limitedDescription = limitDescriptionLength(description);
    const item: ToastItem = {
      id,
      title,
      description: limitedDescription,
      duration,
      variant,
    };

    toasts.value.push(item);

    setTimeout(() => {
      dismiss(id);
    }, duration);

    return id;
  };

  const dismiss = (id: string): void => {
    const index = toasts.value.findIndex((t) => t.id === id);
    if (index !== -1) {
      toasts.value.splice(index, 1);
    }
  };

  const showSuccessToast = (
    category: ToastCategory,
    action: string,
    target?: string,
  ): string => {
    const description = createDescription(action, target);
    return toast({
      title: category,
      description,
      variant: "default",
    });
  };

  const showErrorToast = (
    category: ToastCategory,
    action: string,
    reason?: string,
  ): string => {
    const description = createDescription(action, reason);
    return toast({
      title: category,
      description,
      variant: "destructive",
    });
  };

  return {
    toast,
    dismiss,
    toasts,
    showSuccessToast,
    showErrorToast,
  };
}
