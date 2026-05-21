import { beforeEach, describe, it } from "vitest";
import {
  resetProviderFlowMocks,
  verifyProviderAppManagementFlow,
} from "./integrationProviderFlowUtils";

describe("sentry integration provider flow", () => {
  beforeEach(() => {
    resetProviderFlowMocks();
  });

  it("lets a user add a Sentry integration, see connection updates, and delete it", async () => {
    await verifyProviderAppManagementFlow({
      provider: "sentry",
      formValues: ["incident-stream", "a".repeat(32)],
      createdApp: {
        id: "sentry-app-1",
        name: "incident-stream",
        connectionStatus: "disconnected",
      },
    });
  });
});
