import { v4 as uuidv4 } from "uuid";
import {
  setupIntegrationTest,
  waitForEvent,
  emitAndWaitResponse,
} from "../setup";
import { createPod, getCanvasId } from "../helpers";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type IntegrationAppListPayload,
  type IntegrationAppCreatePayload,
  type IntegrationAppDeletePayload,
  type PodBindIntegrationPayload,
  type PodUnbindIntegrationPayload,
} from "../../src/schemas";
import { integrationAppStore } from "../../src/services/integration/integrationAppStore.js";
import { integrationRegistry } from "../../src/services/integration/integrationRegistry.js";

type IntegrationAppListResult = {
  success: boolean;
  provider?: string;
  apps: Array<{
    id: string;
    name: string;
    provider: string;
    connectionStatus: string;
    config: Record<string, unknown>;
    resources: unknown[];
  }>;
};

type IntegrationAppCreatedResult = {
  success: boolean;
  error?: string;
  code?: string;
  provider?: string;
  app?: {
    id: string;
    name: string;
    provider: string;
    connectionStatus: string;
  };
};

type IntegrationAppDeletedResult = {
  success: boolean;
  error?: string;
  appId?: string;
};

type PodIntegrationBoundResult = {
  success: boolean;
  error?: string;
  code?: string;
  canvasId?: string;
  pod?: {
    id: string;
    integrationBindings?: Array<{ provider: string; appId: string }>;
  };
};

type PodIntegrationUnboundResult = {
  success: boolean;
  error?: string;
  pod?: { id: string; integrationBindings?: Array<{ provider: string }> };
};

function createSlackAppPayload(name: string): IntegrationAppCreatePayload {
  return {
    requestId: uuidv4(),
    provider: "slack",
    name,
    config: {
      botToken: `xoxb-test-${uuidv4().replace(/-/g, "")}`,
      signingSecret: "a".repeat(32),
    },
  };
}

describe("Integration App - 列出 Apps（INTEGRATION_APP_LIST）", () => {
  const { getClient } = setupIntegrationTest();

  it("無 App 時回傳空陣列", async () => {
    const client = getClient();

    const response = await emitAndWaitResponse<
      IntegrationAppListPayload,
      IntegrationAppListResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_LIST,
      WebSocketResponseEvents.INTEGRATION_APP_LIST_RESULT,
      { requestId: uuidv4() },
    );

    expect(response.success).toBe(true);
    expect(Array.isArray(response.apps)).toBe(true);
  });

  it("列出指定 provider 的 Apps", async () => {
    const client = getClient();

    const response = await emitAndWaitResponse<
      IntegrationAppListPayload,
      IntegrationAppListResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_LIST,
      WebSocketResponseEvents.INTEGRATION_APP_LIST_RESULT,
      { requestId: uuidv4(), provider: "slack" },
    );

    expect(response.success).toBe(true);
    expect(Array.isArray(response.apps)).toBe(true);
    const nonSlack = response.apps.filter((a) => a.provider !== "slack");
    expect(nonSlack).toHaveLength(0);
  });
});

describe("Integration App - 建立 App（INTEGRATION_APP_CREATED）", () => {
  const { getClient } = setupIntegrationTest();

  it("成功建立 Slack App", async () => {
    const client = getClient();
    const payload = createSlackAppPayload(`test-slack-create-${uuidv4()}`);

    const response = await emitAndWaitResponse<
      IntegrationAppCreatePayload,
      IntegrationAppCreatedResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_CREATE,
      WebSocketResponseEvents.INTEGRATION_APP_CREATED,
      payload,
    );

    expect(response.success).toBe(true);
    expect(response.app).toBeDefined();
    expect(response.app?.provider).toBe("slack");
    expect(response.app?.name).toBe(payload.name);
  });

  it("provider 不存在應回傳錯誤", async () => {
    const client = getClient();

    const response = await emitAndWaitResponse<
      IntegrationAppCreatePayload,
      IntegrationAppCreatedResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_CREATE,
      WebSocketResponseEvents.INTEGRATION_APP_CREATED,
      {
        requestId: uuidv4(),
        provider: "nonexistent-provider",
        name: "test",
        config: {},
      },
    );

    expect(response.success).toBe(false);
    expect(response.code).toBe("PROVIDER_NOT_FOUND");
  });

  it("config schema 驗證失敗應回傳錯誤", async () => {
    const client = getClient();

    const response = await emitAndWaitResponse<
      IntegrationAppCreatePayload,
      IntegrationAppCreatedResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_CREATE,
      WebSocketResponseEvents.INTEGRATION_APP_CREATED,
      {
        requestId: uuidv4(),
        provider: "slack",
        name: "invalid-config-app",
        config: {
          botToken: "invalid-token-format",
          signingSecret: "tooshort",
        },
      },
    );

    expect(response.success).toBe(false);
    expect(response.code).toBe("VALIDATION_ERROR");
  });
});

describe("Integration App - 刪除 App（INTEGRATION_APP_DELETED）", () => {
  const { getClient } = setupIntegrationTest();

  it("成功刪除 Integration App", async () => {
    const client = getClient();

    const createResponse = await emitAndWaitResponse<
      IntegrationAppCreatePayload,
      IntegrationAppCreatedResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_CREATE,
      WebSocketResponseEvents.INTEGRATION_APP_CREATED,
      createSlackAppPayload(`slack-to-delete-${uuidv4()}`),
    );
    expect(createResponse.success).toBe(true);
    const appId = createResponse.app!.id;

    const deleteResponse = await emitAndWaitResponse<
      IntegrationAppDeletePayload,
      IntegrationAppDeletedResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_DELETE,
      WebSocketResponseEvents.INTEGRATION_APP_DELETED,
      { requestId: uuidv4(), appId },
    );

    expect(deleteResponse.success).toBe(true);
    expect(deleteResponse.appId).toBe(appId);
  });

  it("刪除不存在的 App 回傳錯誤", async () => {
    const client = getClient();

    const response = await emitAndWaitResponse<
      IntegrationAppDeletePayload,
      IntegrationAppDeletedResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_DELETE,
      WebSocketResponseEvents.INTEGRATION_APP_DELETED,
      { requestId: uuidv4(), appId: uuidv4() },
    );

    expect(response.success).toBe(false);
    expect(response.error).toBeDefined();
  });
});

describe("Integration App - Pod 綁定（POD_INTEGRATION_BOUND）", () => {
  const { getClient } = setupIntegrationTest();

  it("App 未 connected 時綁定 Pod 應回傳錯誤", async () => {
    const client = getClient();

    const createResponse = await emitAndWaitResponse<
      IntegrationAppCreatePayload,
      IntegrationAppCreatedResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_CREATE,
      WebSocketResponseEvents.INTEGRATION_APP_CREATED,
      createSlackAppPayload(`slack-not-connected-${uuidv4()}`),
    );
    expect(createResponse.success).toBe(true);
    const appId = createResponse.app!.id;

    const pod = await createPod(client, {
      name: `pod-bind-not-connected-${uuidv4()}`,
    });
    const canvasId = await getCanvasId(client);

    const response = await emitAndWaitResponse<
      PodBindIntegrationPayload,
      PodIntegrationBoundResult
    >(
      client,
      WebSocketRequestEvents.POD_BIND_INTEGRATION,
      WebSocketResponseEvents.POD_INTEGRATION_BOUND,
      {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        appId,
        resourceId: "C123456",
        provider: "slack",
      },
    );

    expect(response.success).toBe(false);
    expect(response.code).toBe("NOT_CONNECTED");
  });

  it("App 不存在時綁定 Pod 應回傳錯誤", async () => {
    const client = getClient();
    const pod = await createPod(client, {
      name: `pod-bind-no-app-${uuidv4()}`,
    });
    const canvasId = await getCanvasId(client);

    const response = await emitAndWaitResponse<
      PodBindIntegrationPayload,
      PodIntegrationBoundResult
    >(
      client,
      WebSocketRequestEvents.POD_BIND_INTEGRATION,
      WebSocketResponseEvents.POD_INTEGRATION_BOUND,
      {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        appId: uuidv4(),
        resourceId: "C123456",
        provider: "slack",
      },
    );

    expect(response.success).toBe(false);
    expect(response.error).toBeDefined();
  });

  it("成功綁定 connected App 的 Pod", async () => {
    const client = getClient();
    const canvasId = await getCanvasId(client);

    const createResponse = await emitAndWaitResponse<
      IntegrationAppCreatePayload,
      IntegrationAppCreatedResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_CREATE,
      WebSocketResponseEvents.INTEGRATION_APP_CREATED,
      createSlackAppPayload(`slack-for-binding-${uuidv4()}`),
    );
    expect(createResponse.success).toBe(true);
    const appId = createResponse.app!.id;

    // 直接在 store 設定為 connected（繞過實際 Slack API 呼叫）
    integrationAppStore.updateStatus(appId, "connected");
    const resourceId = `C-${uuidv4().replace(/-/g, "").slice(0, 8)}`;
    integrationAppStore.updateResources(appId, [
      { id: resourceId, name: "general" },
    ]);

    const pod = await createPod(client, {
      name: `pod-bind-connected-${uuidv4()}`,
    });

    const response = await emitAndWaitResponse<
      PodBindIntegrationPayload,
      PodIntegrationBoundResult
    >(
      client,
      WebSocketRequestEvents.POD_BIND_INTEGRATION,
      WebSocketResponseEvents.POD_INTEGRATION_BOUND,
      {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        appId,
        resourceId,
        provider: "slack",
      },
    );

    expect(response.success).toBe(true);
    expect(response.pod).toBeDefined();
    // 驗證 canvasId 在 success response 中帶對
    expect(response.canvasId).toBe(canvasId);

    const bindings = response.pod?.integrationBindings ?? [];
    const slackBinding = bindings.find((b) => b.provider === "slack");
    expect(slackBinding).toBeDefined();
    expect(slackBinding?.appId).toBe(appId);
  });
});

describe("Integration App - Codex Pod 綁定（POD_INTEGRATION_BOUND）", () => {
  const { getClient } = setupIntegrationTest();

  it("codex provider 的 Pod 可成功綁定 integration app，response.success 為 true 且 canvasId 正確透傳", async () => {
    const client = getClient();
    const canvasId = await getCanvasId(client);

    // 建立 integration app
    const createResponse = await emitAndWaitResponse<
      IntegrationAppCreatePayload,
      IntegrationAppCreatedResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_CREATE,
      WebSocketResponseEvents.INTEGRATION_APP_CREATED,
      createSlackAppPayload(`slack-for-codex-bind-${uuidv4()}`),
    );
    expect(createResponse.success).toBe(true);
    const appId = createResponse.app!.id;

    // 直接將 app 設為 connected（繞過實際 Slack API）
    integrationAppStore.updateStatus(appId, "connected");
    const resourceId = `C-${uuidv4().replace(/-/g, "").slice(0, 8)}`;
    integrationAppStore.updateResources(appId, [
      { id: resourceId, name: "general" },
    ]);

    // 建立 codex provider 的 pod
    const pod = await createPod(client, {
      name: `codex-pod-bind-${uuidv4()}`,
      provider: "codex",
    });

    const response = await emitAndWaitResponse<
      PodBindIntegrationPayload,
      PodIntegrationBoundResult
    >(
      client,
      WebSocketRequestEvents.POD_BIND_INTEGRATION,
      WebSocketResponseEvents.POD_INTEGRATION_BOUND,
      {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        appId,
        resourceId,
        provider: "slack",
      },
    );

    expect(response.success).toBe(true);
    expect(response.pod).toBeDefined();

    const bindings = response.pod?.integrationBindings ?? [];
    const slackBinding = bindings.find((b) => b.provider === "slack");
    expect(slackBinding).toBeDefined();
    expect(slackBinding?.appId).toBe(appId);
  });
});

describe("Integration App - canvasId 透傳驗證", () => {
  const { getClient } = setupIntegrationTest();

  it("成功綁定時 response 帶有正確的 canvasId", async () => {
    const client = getClient();
    const canvasId = await getCanvasId(client);

    const createResponse = await emitAndWaitResponse<
      IntegrationAppCreatePayload,
      IntegrationAppCreatedResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_CREATE,
      WebSocketResponseEvents.INTEGRATION_APP_CREATED,
      createSlackAppPayload(`slack-canvasid-check-${uuidv4()}`),
    );
    expect(createResponse.success).toBe(true);
    const appId = createResponse.app!.id;

    integrationAppStore.updateStatus(appId, "connected");
    const resourceId = `C-${uuidv4().replace(/-/g, "").slice(0, 8)}`;
    integrationAppStore.updateResources(appId, [
      { id: resourceId, name: "general" },
    ]);

    const pod = await createPod(client, {
      name: `pod-canvasid-check-${uuidv4()}`,
    });

    const response = await emitAndWaitResponse<
      PodBindIntegrationPayload,
      PodIntegrationBoundResult
    >(
      client,
      WebSocketRequestEvents.POD_BIND_INTEGRATION,
      WebSocketResponseEvents.POD_INTEGRATION_BOUND,
      {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        appId,
        resourceId,
        provider: "slack",
      },
    );

    expect(response.success).toBe(true);
    expect(response.canvasId).toBe(canvasId);
  });
});

describe("Integration App - Pod 解除綁定（POD_INTEGRATION_UNBOUND）", () => {
  const { getClient } = setupIntegrationTest();

  it("成功解除 Pod 綁定", async () => {
    const client = getClient();
    const canvasId = await getCanvasId(client);

    const createResponse = await emitAndWaitResponse<
      IntegrationAppCreatePayload,
      IntegrationAppCreatedResult
    >(
      client,
      WebSocketRequestEvents.INTEGRATION_APP_CREATE,
      WebSocketResponseEvents.INTEGRATION_APP_CREATED,
      createSlackAppPayload(`slack-for-unbind-${uuidv4()}`),
    );
    const appId = createResponse.app!.id;

    integrationAppStore.updateStatus(appId, "connected");
    const resourceId = `C-${uuidv4().replace(/-/g, "").slice(0, 8)}`;
    integrationAppStore.updateResources(appId, [
      { id: resourceId, name: "general" },
    ]);

    const pod = await createPod(client, { name: `pod-unbind-${uuidv4()}` });

    await emitAndWaitResponse<
      PodBindIntegrationPayload,
      PodIntegrationBoundResult
    >(
      client,
      WebSocketRequestEvents.POD_BIND_INTEGRATION,
      WebSocketResponseEvents.POD_INTEGRATION_BOUND,
      {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        appId,
        resourceId,
        provider: "slack",
      },
    );

    const unbindResponse = await emitAndWaitResponse<
      PodUnbindIntegrationPayload,
      PodIntegrationUnboundResult
    >(
      client,
      WebSocketRequestEvents.POD_UNBIND_INTEGRATION,
      WebSocketResponseEvents.POD_INTEGRATION_UNBOUND,
      {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        provider: "slack",
      },
    );

    expect(unbindResponse.success).toBe(true);
    const bindings = unbindResponse.pod?.integrationBindings ?? [];
    expect(bindings.find((b) => b.provider === "slack")).toBeUndefined();
  });

  it("Pod 未綁定時解除應回傳錯誤", async () => {
    const client = getClient();
    const canvasId = await getCanvasId(client);

    const pod = await createPod(client, { name: `pod-not-bound-${uuidv4()}` });

    const response = await emitAndWaitResponse<
      PodUnbindIntegrationPayload,
      PodIntegrationUnboundResult
    >(
      client,
      WebSocketRequestEvents.POD_UNBIND_INTEGRATION,
      WebSocketResponseEvents.POD_INTEGRATION_UNBOUND,
      {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        provider: "slack",
      },
    );

    expect(response.success).toBe(false);
    expect(response.error).toBeDefined();
  });
});
