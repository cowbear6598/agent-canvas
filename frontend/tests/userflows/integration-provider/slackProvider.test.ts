import { beforeEach, describe, it } from "vitest";
import {
  resetProviderFlowMocks,
  verifyProviderAppManagementFlow,
} from "./integrationProviderFlowUtils";

describe("slack integration provider flow", () => {
  beforeEach(() => {
    resetProviderFlowMocks();
  });

  it("lets a user add a Slack app, see connection updates, and delete it", async () => {
    await verifyProviderAppManagementFlow({
      provider: "slack",
      formValues: ["team-alerts", "xoxb-valid-token", "signing-secret"],
      createdApp: {
        id: "slack-app-1",
        name: "team-alerts",
        connectionStatus: "disconnected",
        resources: [],
      },
      updatedResources: [{ id: "C001", name: "general" }],
      visibleUpdatedResource: "#general",
    });
  });
});
