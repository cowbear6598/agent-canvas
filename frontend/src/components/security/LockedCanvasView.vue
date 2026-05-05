<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronRight, Lock, PanelRightOpen } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSecurityStore } from "@/stores/securityStore";

const canvasStore = useCanvasStore();
const securityStore = useSecurityStore();
const { t } = useI18n();

const lockedCanvases = computed(() =>
  canvasStore.canvases.filter(
    (canvas) =>
      canvas.isProtected && !securityStore.isCanvasUnlocked(canvas.id),
  ),
);

const handleOpenSidebar = (): void => {
  canvasStore.setSidebarOpen(true);
};

const handleUnlockCanvas = (canvasId: string): void => {
  void securityStore.requestCanvasAccess(canvasId);
};
</script>

<template>
  <div class="absolute inset-0 z-20 overflow-hidden">
    <div class="absolute inset-0 canvas-grid bg-[oklch(0.975_0.006_95)]" />
    <div class="absolute inset-0 bg-black/16 backdrop-blur-[2px]" />
    <div class="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.08),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(15,23,42,0.08),transparent_32%)]" />

    <div class="relative z-10 flex h-full items-center justify-center p-4 sm:p-6 lg:p-8">
      <div class="w-full max-w-3xl rounded-[24px] border border-white/45 bg-[rgba(16,16,16,0.74)] text-white shadow-[0_24px_72px_rgba(0,0,0,0.26)] backdrop-blur-xl sm:rounded-[28px]">
        <div class="max-h-[calc(100vh-2rem)] overflow-y-auto p-5 sm:max-h-[calc(100vh-3rem)] sm:p-6 lg:p-7">
          <div class="grid gap-5 lg:grid-cols-[1.02fr_0.98fr] lg:items-start lg:gap-6">
            <section class="space-y-5">
              <div class="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/7 px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.24em] text-amber-100/85 sm:px-4">
                <Lock class="h-3.5 w-3.5" />
                <span>{{ t("security.canvas.lockedState.badge") }}</span>
              </div>

              <div class="space-y-3">
                <h2 class="max-w-2xl text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-4xl">
                  {{ t("security.canvas.lockedState.title") }}
                </h2>
                <p class="max-w-2xl text-sm leading-6 text-white/74 sm:text-[15px] sm:leading-7 lg:text-base">
                  {{ t("security.canvas.lockedState.description") }}
                </p>
              </div>

              <p class="max-w-2xl text-[11px] uppercase tracking-[0.2em] text-amber-100/62 sm:text-xs">
                {{ t("security.canvas.lockedState.hint") }}
              </p>

              <Button
                type="button"
                variant="outline"
                class="w-full border-white/18 bg-white/10 text-white hover:bg-white/14 sm:w-auto"
                @click="handleOpenSidebar"
              >
                <PanelRightOpen class="mr-2 h-4 w-4" />
                {{ t("security.canvas.lockedState.openSidebar") }}
              </Button>
            </section>

            <section class="rounded-[22px] border border-white/10 bg-white/8 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:rounded-[24px] sm:p-3">
              <div class="space-y-1 px-3 py-3 sm:px-4">
                <p class="text-sm font-medium text-white">
                  {{ t("security.canvas.lockedState.listTitle") }}
                </p>
                <p class="text-xs text-white/56">
                  {{
                    t("security.canvas.lockedState.listDescription", {
                      count: lockedCanvases.length,
                    })
                  }}
                </p>
              </div>

              <div class="space-y-2">
                <button
                  v-for="canvas in lockedCanvases"
                  :key="canvas.id"
                  type="button"
                  class="flex w-full flex-col items-start gap-4 rounded-2xl border border-white/10 bg-black/18 px-4 py-4 text-left transition hover:border-amber-200/24 hover:bg-black/26 focus:outline-none focus:ring-2 focus:ring-amber-200/30 sm:flex-row sm:items-center sm:justify-between"
                  @click="handleUnlockCanvas(canvas.id)"
                >
                  <div class="flex min-w-0 items-center gap-3">
                    <div class="rounded-xl border border-white/10 bg-white/10 p-2 text-amber-100/90">
                      <Lock class="h-4 w-4" />
                    </div>
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium text-white">
                        {{ canvas.name }}
                      </p>
                      <p class="text-xs text-white/52">
                        {{ t("security.canvas.lockedState.itemHint") }}
                      </p>
                    </div>
                  </div>

                  <span class="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.18em] text-amber-100/88 sm:ml-4 sm:text-xs">
                    {{ t("security.canvas.lockedState.unlockAction") }}
                    <ChevronRight class="h-3.5 w-3.5" />
                  </span>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
