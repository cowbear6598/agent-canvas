import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/useToast";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";
import type {
  OpencodeModelAlias,
  OpencodeModelInfo,
  OpencodeProviderInfo,
} from "@/types/opencode";

export interface OpencodeAliasDraftRow {
  modelID: string;
  alias: string;
}

export interface UseOpencodeAliasEditorOptions {
  providers: Ref<OpencodeProviderInfo[]>;
  connected: Ref<string[]>;
}

export interface UseOpencodeAliasEditorReturn {
  editingAliasId: Ref<string | null>;
  draftRows: Ref<Record<string, OpencodeAliasDraftRow | null>>;
  aliasListsByProvider: Ref<Record<string, OpencodeModelAlias[]>>;
  deleteConfirmOpen: Ref<boolean>;
  pendingDeleteAlias: Ref<string>;
  savingDraftProviderIds: Ref<Set<string>>;
  refreshingAliasIds: Ref<Set<string>>;
  draftSelectableModelsByProvider: ComputedRef<
    Record<string, OpencodeModelInfo[]>
  >;
  firstDraftSelectableModelIDByProvider: ComputedRef<Record<string, string>>;
  editableSelectableModelsByAliasId: ComputedRef<
    Record<string, OpencodeModelInfo[]>
  >;
  aliasCountByProvider: ComputedRef<Record<string, number>>;
  isProviderExpanded: (providerID: string) => boolean;
  setProviderExpanded: (providerID: string, value: boolean) => void;
  handleAddClick: (providerID: string, firstModelID: string) => void;
  handleDraftSave: (
    providerID: string,
    payload: OpencodeAliasDraftRow,
  ) => Promise<void>;
  handleDraftCancel: (providerID: string) => void;
  handleStartEdit: (aliasId: string) => void;
  handleCancelEdit: () => void;
  handleEditSave: (
    aliasId: string,
    providerID: string,
    payload: OpencodeAliasDraftRow,
  ) => Promise<void>;
  handleRefreshPresets: (aliasId: string) => Promise<void>;
  handleDeleteClick: (aliasId: string, aliasName: string) => void;
  setDeleteConfirmOpen: (open: boolean) => void;
  handleDeleteConfirm: () => Promise<void>;
  updateAliasListForProvider: (
    providerID: string,
    list: OpencodeModelAlias[],
  ) => void;
  handleAliasReorder: (providerID: string) => Promise<void>;
}

export function useOpencodeAliasEditor({
  providers,
  connected,
}: UseOpencodeAliasEditorOptions): UseOpencodeAliasEditorReturn {
  const { t } = useI18n();
  const { toast } = useToast();
  const opencodeAliasStore = useOpencodeAliasStore();

  const editingAliasId = ref<string | null>(null);
  const draftRows = ref<Record<string, OpencodeAliasDraftRow | null>>({});
  const expandedProviders = ref<Record<string, boolean>>({});
  const aliasListsByProvider = ref<Record<string, OpencodeModelAlias[]>>({});
  const deleteConfirmOpen = ref(false);
  const pendingDeleteId = ref<string | null>(null);
  const pendingDeleteAlias = ref("");
  const savingDraftProviderIds = ref<Set<string>>(new Set());
  const refreshingAliasIds = ref<Set<string>>(new Set());

  const isProviderExpanded = (providerID: string): boolean =>
    !!expandedProviders.value[providerID];

  const setProviderExpanded = (providerID: string, value: boolean): void => {
    expandedProviders.value[providerID] = value;
  };

  const setSavingDraft = (providerID: string, saving: boolean): void => {
    const next = new Set(savingDraftProviderIds.value);
    if (saving) {
      next.add(providerID);
    } else {
      next.delete(providerID);
    }
    savingDraftProviderIds.value = next;
  };

  const setRefreshingAlias = (aliasId: string, refreshing: boolean): void => {
    const next = new Set(refreshingAliasIds.value);
    if (refreshing) {
      next.add(aliasId);
    } else {
      next.delete(aliasId);
    }
    refreshingAliasIds.value = next;
  };

  const syncAliasListsFromStore = (providerIDs: string[]): void => {
    for (const id of providerIDs) {
      aliasListsByProvider.value[id] = [
        ...opencodeAliasStore.aliasesByProvider(id),
      ];
    }
  };

  watch(
    [(): OpencodeModelAlias[] => opencodeAliasStore.aliases, connected],
    () => {
      syncAliasListsFromStore(connected.value);
    },
    { immediate: true },
  );

  const draftSelectableModelsByProvider = computed<
    Record<string, OpencodeModelInfo[]>
  >(() => {
    const selectableModels: Record<string, OpencodeModelInfo[]> = {};

    for (const provider of providers.value) {
      const usedModelIDs = new Set(
        opencodeAliasStore
          .aliasesByProvider(provider.id)
          .map((alias) => alias.modelID),
      );
      selectableModels[provider.id] = provider.models.filter(
        (model) => !usedModelIDs.has(model.id),
      );
    }

    return selectableModels;
  });

  const firstDraftSelectableModelIDByProvider = computed<Record<string, string>>(
    () =>
      Object.fromEntries(
        providers.value.map((provider) => [
          provider.id,
          draftSelectableModelsByProvider.value[provider.id]?.[0]?.id ?? "",
        ]),
      ),
  );

  const editableSelectableModelsByAliasId = computed<
    Record<string, OpencodeModelInfo[]>
  >(() => {
    const selectableModels: Record<string, OpencodeModelInfo[]> = {};

    for (const provider of providers.value) {
      const providerAliases = opencodeAliasStore.aliasesByProvider(provider.id);
      if (providerAliases.length === 0) {
        continue;
      }

      const usedModelIDs = new Set(
        providerAliases.map((aliasItem) => aliasItem.modelID),
      );

      for (const aliasItem of providerAliases) {
        const selectableModelIDs = new Set(usedModelIDs);
        selectableModelIDs.delete(aliasItem.modelID);
        selectableModels[aliasItem.id] = provider.models.filter(
          (model) => !selectableModelIDs.has(model.id),
        );
      }
    }

    return selectableModels;
  });

  const aliasCountByProvider = computed<Record<string, number>>(() =>
    Object.fromEntries(
      providers.value.map((provider) => [
        provider.id,
        opencodeAliasStore.aliasesByProvider(provider.id).length,
      ]),
    ),
  );

  const handleAddClick = (providerID: string, firstModelID: string): void => {
    setProviderExpanded(providerID, true);
    draftRows.value = {
      ...draftRows.value,
      [providerID]: { modelID: firstModelID, alias: "" },
    };
  };

  const handleDraftSave = async (
    providerID: string,
    payload: OpencodeAliasDraftRow,
  ): Promise<void> => {
    const isUnique = opencodeAliasStore.isAliasUnique(providerID, payload.alias);
    if (!isUnique) {
      toast({
        title: t("llmProvider.opencode.aliases.aliasDuplicateError"),
        variant: "destructive",
      });
      return;
    }

    try {
      setSavingDraft(providerID, true);
      await opencodeAliasStore.addAlias({
        providerID,
        modelID: payload.modelID,
        alias: payload.alias,
      });
      draftRows.value = { ...draftRows.value, [providerID]: null };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toast({
        title: t("llmProvider.opencode.aliases.actionFailed", { reason }),
        variant: "destructive",
      });
    } finally {
      setSavingDraft(providerID, false);
    }
  };

  const handleDraftCancel = (providerID: string): void => {
    draftRows.value = { ...draftRows.value, [providerID]: null };
  };

  const handleStartEdit = (aliasId: string): void => {
    editingAliasId.value = aliasId;
  };

  const handleCancelEdit = (): void => {
    editingAliasId.value = null;
  };

  const handleEditSave = async (
    aliasId: string,
    providerID: string,
    payload: OpencodeAliasDraftRow,
  ): Promise<void> => {
    const isUnique = opencodeAliasStore.isAliasUnique(
      providerID,
      payload.alias,
      aliasId,
    );
    if (!isUnique) {
      toast({
        title: t("llmProvider.opencode.aliases.aliasDuplicateError"),
        variant: "destructive",
      });
      return;
    }

    try {
      await opencodeAliasStore.editAlias({
        id: aliasId,
        modelID: payload.modelID,
        alias: payload.alias,
      });
      editingAliasId.value = null;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toast({
        title: t("llmProvider.opencode.aliases.actionFailed", { reason }),
        variant: "destructive",
      });
    }
  };

  const handleRefreshPresets = async (aliasId: string): Promise<void> => {
    try {
      setRefreshingAlias(aliasId, true);
      await opencodeAliasStore.refreshPresets(aliasId);
      toast({ title: t("llmProvider.opencode.aliases.refreshSuccess") });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toast({
        title: t("llmProvider.opencode.aliases.refreshFailed", { reason }),
        variant: "destructive",
      });
    } finally {
      setRefreshingAlias(aliasId, false);
    }
  };

  const handleDeleteClick = (aliasId: string, aliasName: string): void => {
    pendingDeleteId.value = aliasId;
    pendingDeleteAlias.value = aliasName;
    deleteConfirmOpen.value = true;
  };

  const setDeleteConfirmOpen = (open: boolean): void => {
    deleteConfirmOpen.value = open;
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!pendingDeleteId.value) return;
    const id = pendingDeleteId.value;
    deleteConfirmOpen.value = false;

    try {
      await opencodeAliasStore.removeAlias(id);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toast({
        title: t("llmProvider.opencode.aliases.actionFailed", { reason }),
        variant: "destructive",
      });
    } finally {
      pendingDeleteId.value = null;
      pendingDeleteAlias.value = "";
    }
  };

  const updateAliasListForProvider = (
    providerID: string,
    list: OpencodeModelAlias[],
  ): void => {
    aliasListsByProvider.value[providerID] = list;
  };

  const handleAliasReorder = async (providerID: string): Promise<void> => {
    const ids = (aliasListsByProvider.value[providerID] ?? []).map(
      (alias) => alias.id,
    );
    try {
      await opencodeAliasStore.reorder(ids);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toast({
        title: t("llmProvider.opencode.aliases.actionFailed", { reason }),
        variant: "destructive",
      });
    }
  };

  return {
    editingAliasId,
    draftRows,
    aliasListsByProvider,
    deleteConfirmOpen,
    pendingDeleteAlias,
    savingDraftProviderIds,
    refreshingAliasIds,
    draftSelectableModelsByProvider,
    firstDraftSelectableModelIDByProvider,
    editableSelectableModelsByAliasId,
    aliasCountByProvider,
    isProviderExpanded,
    setProviderExpanded,
    handleAddClick,
    handleDraftSave,
    handleDraftCancel,
    handleStartEdit,
    handleCancelEdit,
    handleEditSave,
    handleRefreshPresets,
    handleDeleteClick,
    setDeleteConfirmOpen,
    handleDeleteConfirm,
    updateAliasListForProvider,
    handleAliasReorder,
  };
}
