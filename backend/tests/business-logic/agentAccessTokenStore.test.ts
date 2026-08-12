import { closeDb, initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import {
  agentAccessTokenStore,
  type AgentAccessTokenRecord,
} from "../../src/services/agentAccess/agentAccessTokenStore.js";

describe("AgentAccessTokenStore", () => {
  beforeEach(() => {
    resetStatements();
    const db = initTestDb();
    db.exec(
      "INSERT INTO canvases (id, name, sort_index) VALUES ('canvas-a', 'Canvas A', 0)",
    );
  });

  afterEach(() => {
    closeDb();
  });

  it("只儲存遮罩資訊，並讓 canvas:write 自動包含 canvas:read", () => {
    const created = agentAccessTokenStore.create({
      name: "外部 AI",
      scopes: ["canvas:write"],
      canvasIds: ["canvas-a"],
      expiration: "90d",
    });

    expect(created.token).toMatch(/^acv1_/);
    expect(created.record).not.toHaveProperty("token");
    expect(created.record.tokenHint).not.toContain(created.token);

    const verified = agentAccessTokenStore.verify(created.token);
    expect(verified?.canvasIds).toEqual(["canvas-a"]);
    expect(verified?.hasScope("canvas:read")).toBe(true);
    expect(verified?.hasScope("canvas:write")).toBe(true);
    expect(verified?.hasScope("canvas:execute")).toBe(false);
  });

  it("撤銷後立即拒絕，且不接受遭竄改的 Token", () => {
    const created = agentAccessTokenStore.create({
      name: "可撤銷",
      scopes: ["canvas:execute"],
      canvasIds: [],
      expiration: "never",
    });
    expect(agentAccessTokenStore.verify(`${created.token}x`)).toBeNull();
    expect(agentAccessTokenStore.revoke(created.record.id)).toBe(true);
    expect(agentAccessTokenStore.verify(created.token)).toBeNull();
  });

  it("到期後拒絕新的 API 驗證", () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const created = agentAccessTokenStore.create({
      name: "短效",
      scopes: [],
      canvasIds: [],
      expiration: "7d",
      now: issuedAt,
    });
    expect(
      agentAccessTokenStore.verify(
        created.token,
        new Date("2026-01-08T00:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("建立 Canvas 後只增加該 Token 自己的授權範圍", () => {
    const first = agentAccessTokenStore.create({
      name: "建立者",
      scopes: ["canvas:create"],
      canvasIds: [],
      expiration: "never",
    });
    const second = agentAccessTokenStore.create({
      name: "其他 Token",
      scopes: ["canvas:create"],
      canvasIds: [],
      expiration: "never",
    });

    agentAccessTokenStore.grantCanvas(first.record.id, "canvas-a");

    expect(agentAccessTokenStore.getById(first.record.id)?.canvasIds).toEqual([
      "canvas-a",
    ]);
    expect(
      (agentAccessTokenStore.getById(second.record.id) as AgentAccessTokenRecord)
        .canvasIds,
    ).toEqual([]);
  });
});
