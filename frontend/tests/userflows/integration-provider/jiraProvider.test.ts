import { beforeEach, describe, it } from "vitest";
import {
  resetProviderFlowMocks,
  verifyProviderAppManagementFlow,
} from "./integrationProviderFlowUtils";

describe("jira integration provider flow", () => {
  beforeEach(() => {
    resetProviderFlowMocks();
  });

  it("lets a user add a Jira integration, see connection updates, and delete it", async () => {
    await verifyProviderAppManagementFlow({
      provider: "jira",
      formValues: [
        "project-automation",
        "https://example.atlassian.net",
        "1234567890123456",
      ],
      createdApp: {
        id: "jira-app-1",
        name: "project-automation",
        connectionStatus: "disconnected",
      },
    });
  });
});
