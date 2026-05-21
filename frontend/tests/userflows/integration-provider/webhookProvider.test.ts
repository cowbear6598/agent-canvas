import { beforeEach, describe, it } from "vitest";
import {
  resetProviderFlowMocks,
  verifyProviderAppManagementFlow,
} from "./integrationProviderFlowUtils";

describe("webhook integration provider flow", () => {
  beforeEach(() => {
    resetProviderFlowMocks();
  });

  it("lets a user add a Webhook integration, see connection updates, and delete it", async () => {
    await verifyProviderAppManagementFlow({
      provider: "webhook",
      formValues: ["deploy-hook"],
      createdApp: {
        id: "webhook-app-1",
        name: "deploy-hook",
        connectionStatus: "connected",
        config: { token: "fake-token" },
      },
    });
  });
});
