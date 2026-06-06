import { beforeEach, describe, it } from "vitest";
import {
  resetProviderFlowMocks,
  verifyProviderAppManagementFlow,
} from "./integrationProviderFlowUtils";

describe("discord integration provider flow", () => {
  beforeEach(() => {
    resetProviderFlowMocks();
  });

  it("lets a user add a Discord app, see synced channels, and delete it", async () => {
    await verifyProviderAppManagementFlow({
      provider: "discord",
      formValues: ["release-bot", "discord-bot-token"],
      createdApp: {
        id: "discord-app-1",
        name: "release-bot",
        connectionStatus: "disconnected",
        resources: [],
      },
      updatedResources: [
        {
          id: "channel-1",
          name: "deployments",
          guildName: "Release Guild",
          channelName: "deployments",
        },
      ],
      visibleUpdatedResource: "Release Guild / #deployments",
    });
  });
});
