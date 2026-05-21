import { beforeEach, describe, it } from "vitest";
import {
  resetProviderFlowMocks,
  verifyProviderAppManagementFlow,
} from "./integrationProviderFlowUtils";

describe("telegram integration provider flow", () => {
  beforeEach(() => {
    resetProviderFlowMocks();
  });

  it("lets a user add a Telegram bot, see connection updates, and delete it", async () => {
    await verifyProviderAppManagementFlow({
      provider: "telegram",
      formValues: ["release-bot", "123456:ABC-DEF"],
      createdApp: {
        id: "telegram-app-1",
        name: "release-bot",
        connectionStatus: "disconnected",
        botUsername: "release_bot",
      },
    });
  });
});
