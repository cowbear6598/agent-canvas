import { describe, expect, it } from "vitest";
import IntegrationSelectModal from "@/components/integration/IntegrationSelectModal.vue";
import IntegrationStatusIcon from "@/components/integration/IntegrationStatusIcon.vue";
import { getAllProviders } from "@/integration/providerRegistry";
import { useIntegrationStore } from "@/stores/integrationStore";
import type { IntegrationBinding } from "@/types/integration";
import { mountUserFlowApp } from "@tests/helpers/userFlowLauncher";

describe("integration provider registry user flow", () => {
  it("shows every configurable provider in the integration picker", async () => {
    const { wrapper, unmount } = await mountUserFlowApp({
      component: IntegrationSelectModal,
      props: { open: true },
      attachTo: document.body,
    });

    try {
      const providerLabels = getAllProviders().map((provider) => provider.label);
      for (const label of providerLabels) {
        expect(document.body.textContent).toContain(label);
      }
    } finally {
      unmount();
    }
  });

  it("shows provider status for connected, disconnected, error, and removed integrations", async () => {
    const bindings: IntegrationBinding[] = [
      { provider: "slack", appId: "slack-app", resourceId: "C001", extra: {} },
      {
        provider: "telegram",
        appId: "telegram-app",
        resourceId: "12345",
        extra: {},
      },
      { provider: "jira", appId: "jira-app", resourceId: "*", extra: {} },
      {
        provider: "missing-provider",
        appId: "missing-app",
        resourceId: "*",
        extra: {},
      },
    ];

    const { wrapper, unmount } = await mountUserFlowApp({
      component: IntegrationStatusIcon,
      props: { bindings },
      attachTo: document.body,
    });
    const integrationStore = useIntegrationStore();

    integrationStore.apps = {
      slack: [
        {
          id: "slack-app",
          name: "Team Slack",
          provider: "slack",
          connectionStatus: "connected",
          resources: [{ id: "C001", label: "#general" }],
          raw: {},
        },
      ],
      telegram: [
        {
          id: "telegram-app",
          name: "Ops Telegram",
          provider: "telegram",
          connectionStatus: "disconnected",
          resources: [],
          raw: {},
        },
      ],
      jira: [
        {
          id: "jira-app",
          name: "Project Jira",
          provider: "jira",
          connectionStatus: "error",
          resources: [],
          raw: {},
        },
      ],
    };

    await wrapper.vm.$nextTick();

    try {
      const titles = wrapper
        .findAll("[title]")
        .map((node) => node.attributes("title"));

      expect(titles).toEqual(
        expect.arrayContaining([
          "Slack 已連接：Team Slack",
          "Telegram 已斷線：Ops Telegram",
          "Jira 錯誤：Project Jira",
          "missing-provider App 已移除",
        ]),
      );
    } finally {
      unmount();
    }
  });
});
