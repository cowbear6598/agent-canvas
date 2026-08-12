import { handleApiRequest } from "../../src/api/apiRouter.js";
import {
  handleAgentAccessTokenCreate,
  handleAgentAccessTokenList,
} from "../../src/api/agentAccessManagementApi.js";
import { closeDb, initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { agentAccessTokenStore } from "../../src/services/agentAccess/agentAccessTokenStore.js";

describe("外部 Agent REST API 授權", () => {
  const canvasA = "11111111-1111-4111-8111-111111111111";
  const canvasB = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    resetStatements();
    const db = initTestDb();
    db.exec(
      `INSERT INTO canvases (id, name, sort_index)
       VALUES ('${canvasA}', 'Canvas A', 0), ('${canvasB}', 'Canvas B', 1)`,
    );
  });

  afterEach(() => {
    closeDb();
  });

  it("缺少 Bearer Token 時回傳 401", async () => {
    const response = await handleApiRequest(
      new Request("http://localhost/api/v1/canvases"),
    );
    expect(response?.status).toBe(401);
  });

  it("canvas:write 可讀取，但清單只包含已授權 Canvas", async () => {
    const created = agentAccessTokenStore.create({
      name: "編輯者",
      scopes: ["canvas:write"],
      canvasIds: [canvasA],
      expiration: "never",
    });
    const response = await handleApiRequest(
      new Request("http://localhost/api/v1/canvases", {
        headers: { Authorization: `Bearer ${created.token}` },
      }),
    );
    const body = (await response?.json()) as {
      canvases: Array<{ id: string }>;
    };

    expect(response?.status).toBe(200);
    expect(body.canvases.map((canvas) => canvas.id)).toEqual([canvasA]);
  });

  it("Canvas scope 與操作 scope 分開檢查", async () => {
    const created = agentAccessTokenStore.create({
      name: "只讀",
      scopes: ["canvas:read"],
      canvasIds: [canvasA],
      expiration: "never",
    });
    const headers = { Authorization: `Bearer ${created.token}` };

    const ungranted = await handleApiRequest(
      new Request(`http://localhost/api/v1/canvases/${canvasB}`, { headers }),
    );
    const noExecute = await handleApiRequest(
      new Request(`http://localhost/api/v1/canvases/${canvasA}/workflows`, {
        headers,
      }),
    );

    expect(ungranted?.status).toBe(403);
    expect(noExecute?.status).toBe(403);
  });

  it("管理清單不再顯示已撤銷的 Token", async () => {
    const created = agentAccessTokenStore.create({
      name: "待撤銷",
      scopes: ["canvas:read"],
      canvasIds: [canvasA],
      expiration: "never",
    });
    agentAccessTokenStore.revoke(created.record.id);

    const response = await handleAgentAccessTokenList();
    const body = (await response.json()) as {
      tokens: Array<{ id: string }>;
    };

    expect(body.tokens).toEqual([]);
  });

  it("建立 Token 時至少需要一個權限與一個 Canvas", async () => {
    const noScope = await handleAgentAccessTokenCreate(
      new Request("http://localhost/api/ai-access/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "無權限",
          scopes: [],
          canvasIds: [canvasA],
          expiration: "90d",
        }),
      }),
    );
    const noCanvas = await handleAgentAccessTokenCreate(
      new Request("http://localhost/api/ai-access/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "無 Canvas",
          scopes: ["canvas:read"],
          canvasIds: [],
          expiration: "90d",
        }),
      }),
    );

    expect(noScope.status).toBe(400);
    expect(noCanvas.status).toBe(400);
  });
});
