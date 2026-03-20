<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import { FolderOpen, Unplug, Puzzle, ChevronRight } from "lucide-vue-next";
import { useToast } from "@/composables/useToast";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import type { PodOpenDirectoryPayload } from "@/types/websocket/requests";
import type { PodDirectoryOpenedPayload } from "@/types/websocket/responses";
import { useSendCanvasAction } from "@/composables/useSendCanvasAction";
import { usePodStore } from "@/stores";
import { getAllProviders } from "@/integration/providerRegistry";
import PodPluginSubMenu from "./PodPluginSubMenu.vue";
import { usePluginSubMenu } from "@/composables/canvas/usePluginSubMenu";

interface Props {
  position: { x: number; y: number };
  podId: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  "connect-integration": [podId: string, provider: string];
  "disconnect-integration": [podId: string, provider: string];
}>();

const { toast } = useToast();

const pod = computed(() => usePodStore().getPodById(props.podId));
const bindings = computed(() => pod.value?.integrationBindings ?? []);
const providers = getAllProviders();

const menuRef = ref<HTMLElement | null>(null);
const subMenuRef = ref<InstanceType<typeof PodPluginSubMenu> | null>(null);

const {
  showPluginSubMenu,
  pluginMenuPosition,
  handlePluginMenuEnter,
  handlePluginMenuLeave,
  handlePluginSubMenuCancelClose,
  handlePluginSubMenuClose,
} = usePluginSubMenu();

const isBound = (provider: string): boolean =>
  bindings.value.some((b) => b.provider === provider);

const handleOutsideClick = (event: MouseEvent): void => {
  const menuEl = menuRef.value;
  const subMenuEl = subMenuRef.value?.$el as HTMLElement | undefined;

  const insideMenu = menuEl?.contains(event.target as Node) ?? false;
  const insideSubMenu = subMenuEl?.contains(event.target as Node) ?? false;

  if (insideMenu || insideSubMenu) return;

  // 右鍵點選單外部：關閉選單，讓事件繼續傳播到 canvas/pod
  // 左鍵點選單外部：關閉選單並停止事件傳播
  if (event.button !== 2) {
    event.stopPropagation();
  }

  emit("close");
};

onMounted(() => {
  document.addEventListener("mousedown", handleOutsideClick, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutsideClick, true);
});

const handleOpenDirectory = async (): Promise<void> => {
  const { sendCanvasAction } = useSendCanvasAction();

  const response = await sendCanvasAction<
    PodOpenDirectoryPayload,
    PodDirectoryOpenedPayload
  >({
    requestEvent: WebSocketRequestEvents.POD_OPEN_DIRECTORY,
    responseEvent: WebSocketResponseEvents.POD_DIRECTORY_OPENED,
    payload: { podId: props.podId },
  });

  if (!response) {
    toast({
      title: "打開目錄失敗",
      description: "無法打開工作目錄，請稍後再試",
      variant: "destructive",
    });
    return;
  }

  emit("close");
};

const handleConnect = (provider: string): void => {
  emit("connect-integration", props.podId, provider);
  emit("close");
};

const handleDisconnect = (provider: string): void => {
  emit("disconnect-integration", props.podId, provider);
  emit("close");
};
</script>

<template>
  <div
    ref="menuRef"
    class="bg-card border border-doodle-ink rounded-md p-1 fixed z-50"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
    }"
    @contextmenu.prevent
  >
    <button
      class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
      @click="handleOpenDirectory"
    >
      <FolderOpen :size="14" />
      <span class="font-mono">打開工作目錄</span>
    </button>

    <div class="my-1 border-t border-border" />

    <button
      class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
      @mouseenter="handlePluginMenuEnter"
      @mouseleave="handlePluginMenuLeave"
    >
      <Puzzle :size="14" />
      <span class="font-mono flex-1">Plugin</span>
      <ChevronRight :size="12" />
    </button>

    <template v-for="provider in providers" :key="provider.name">
      <div class="my-1 border-t border-border" />

      <button
        v-if="!isBound(provider.name)"
        class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
        @click="handleConnect(provider.name)"
      >
        <component :is="provider.icon" :size="14" />
        <span class="font-mono">連接 {{ provider.label }}</span>
      </button>

      <button
        v-else
        class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
        @click="handleDisconnect(provider.name)"
      >
        <Unplug :size="14" />
        <span class="font-mono">斷開 {{ provider.label }}</span>
      </button>
    </template>
  </div>

  <PodPluginSubMenu
    v-if="showPluginSubMenu"
    ref="subMenuRef"
    :pod-id="podId"
    :position="pluginMenuPosition"
    @cancel-close="handlePluginSubMenuCancelClose"
    @close="handlePluginSubMenuClose"
  />
</template>
