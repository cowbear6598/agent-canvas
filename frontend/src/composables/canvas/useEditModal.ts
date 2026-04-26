import { ref } from "vue";
import type { Ref } from "vue";
import type { Group, Position } from "@/types";
import { screenToCanvasPosition } from "@/lib/canvasCoordinateUtils";
import { t } from "@/i18n";

type ResourceType = "command";
type GroupType = "commandGroup";
type ExtendedResourceType = ResourceType | GroupType;

interface EditModalState {
  visible: boolean;
  mode: "create" | "edit";
  title: string;
  initialName: string;
  initialContent: string;
  resourceType: ExtendedResourceType;
  itemId: string;
  showContent: boolean;
}

interface ResourceStore {
  readCommand?: (
    id: string,
  ) => Promise<{ id: string; name: string; content: string } | null>;
  createCommand?: (
    name: string,
    content: string,
  ) => Promise<{
    success: boolean;
    command?: { id: string };
    [key: string]: unknown;
  }>;
  updateCommand?: (id: string, content: string) => Promise<unknown>;
  createNote: (id: string, x: number, y: number) => Promise<void>;
  createGroup?: (
    name: string,
  ) => Promise<{ success: boolean; group?: Group; error?: string }>;
}

type ResourceStoreMap = Record<ResourceType, ResourceStore>;

interface EditModalStores {
  commandStore: ResourceStore;
  viewportStore: { offset: { x: number; y: number }; zoom: number };
}

const resourceTitleMap: Record<ResourceType, string> = {
  command: "Command",
};

export function useEditModal(
  stores: EditModalStores,
  lastMenuPosition: Ref<Position | null>,
): {
  editModal: Ref<EditModalState>;
  handleOpenCreateModal: (resourceType: ResourceType, title: string) => void;
  handleOpenCreateGroupModal: (groupType: GroupType, title: string) => void;
  handleOpenEditModal: (
    resourceType: ResourceType,
    id: string,
  ) => Promise<void>;
  handleCreateEditSubmit: (payload: {
    name: string;
    content: string;
  }) => Promise<void>;
  closeEditModal: () => void;
} {
  const { commandStore, viewportStore } = stores;

  const editModal = ref<EditModalState>({
    visible: false,
    mode: "create",
    title: "",
    initialName: "",
    initialContent: "",
    resourceType: "command",
    itemId: "",
    showContent: true,
  });

  const resourceStoreMap: ResourceStoreMap = {
    command: commandStore,
  };

  const readActions: Record<
    ResourceType,
    (
      id: string,
    ) => Promise<{ id: string; name: string; content: string } | null>
  > = {
    command: (id) => commandStore.readCommand?.(id) ?? Promise.resolve(null),
  };

  function getCanvasPosition(): { x: number; y: number } | null {
    if (!lastMenuPosition.value) return null;
    return screenToCanvasPosition(lastMenuPosition.value, viewportStore);
  }

  async function createResourceWithNote(
    name: string,
    content: string,
    createFn: (
      name: string,
      content: string,
    ) => Promise<{ success: boolean; [key: string]: unknown }>,
    storeKey: ResourceType,
  ): Promise<void> {
    const result = await createFn(name, content);

    if (!result.success) return;

    const resource = result[storeKey];
    if (!resource || typeof resource !== "object" || !("id" in resource))
      return;

    const position = getCanvasPosition();
    if (!position) return;

    const store = resourceStoreMap[storeKey];
    await store.createNote(
      (resource as { id: string }).id,
      position.x,
      position.y,
    );
  }

  function createItemAction(
    storeKey: ResourceType,
    name: string,
    content: string,
  ): () => Promise<void> {
    const store = resourceStoreMap[storeKey];
    const createFnMap: Partial<
      Record<
        ResourceType,
        (
          n: string,
          c: string,
        ) => Promise<{ success: boolean; [key: string]: unknown }>
      >
    > = {
      command: store.createCommand,
    };
    const createFn = createFnMap[storeKey];

    if (!createFn) return async () => {};

    return () => createResourceWithNote(name, content, createFn, storeKey);
  }

  function handleOpenCreateModal(
    resourceType: ResourceType,
    title: string,
  ): void {
    editModal.value = {
      visible: true,
      mode: "create",
      title,
      initialName: "",
      initialContent: "",
      resourceType,
      itemId: "",
      showContent: true,
    };
  }

  function handleOpenCreateGroupModal(
    groupType: GroupType,
    title: string,
  ): void {
    editModal.value = {
      visible: true,
      mode: "create",
      title,
      initialName: "",
      initialContent: "",
      resourceType: groupType,
      itemId: "",
      showContent: false,
    };
  }

  async function handleOpenEditModal(
    resourceType: ResourceType,
    id: string,
  ): Promise<void> {
    const data = await readActions[resourceType](id);

    if (!data) {
      if (import.meta.env.DEV) {
        console.error(
          `無法讀取 ${resourceTitleMap[resourceType]} (id: ${id})，請確認後端是否正常運作`,
        );
      }
      return;
    }

    editModal.value = {
      visible: true,
      mode: "edit",
      title: t("composable.editModal.editTitle", {
        resource: resourceTitleMap[resourceType],
      }),
      initialName: data.name,
      initialContent: data.content,
      resourceType,
      itemId: id,
      showContent: true,
    };
  }

  async function handleUpdate(name: string, content: string): Promise<void> {
    const { resourceType, itemId } = editModal.value;

    const updateActions: Partial<
      Record<ExtendedResourceType, () => Promise<unknown>>
    > = {
      command: () =>
        commandStore.updateCommand?.(itemId, content) ?? Promise.resolve(),
    };

    const action = updateActions[resourceType];
    if (action) {
      await action();
    }

    editModal.value.visible = false;
  }

  async function handleCreate(name: string, content: string): Promise<void> {
    const { resourceType } = editModal.value;

    const createActions: Record<
      ExtendedResourceType,
      () => Promise<void | { success: boolean; group?: Group; error?: string }>
    > = {
      command: createItemAction("command", name, content),
      commandGroup: () =>
        commandStore.createGroup?.(name) ?? Promise.resolve({ success: false }),
    };

    await createActions[resourceType]();
    editModal.value.visible = false;
  }

  async function handleCreateEditSubmit(payload: {
    name: string;
    content: string;
  }): Promise<void> {
    const { name, content } = payload;

    if (editModal.value.mode === "edit") {
      await handleUpdate(name, content);
      return;
    }

    await handleCreate(name, content);
  }

  function closeEditModal(): void {
    editModal.value.visible = false;
  }

  return {
    editModal,
    handleOpenCreateModal,
    handleOpenCreateGroupModal,
    handleOpenEditModal,
    handleCreateEditSubmit,
    closeEditModal,
  };
}
