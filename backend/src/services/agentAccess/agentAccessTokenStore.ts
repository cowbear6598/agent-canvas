import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { getDb } from "../../database/index.js";

export const AGENT_ACCESS_SCOPES = [
  "canvas:read",
  "canvas:create",
  "canvas:write",
  "canvas:execute",
] as const;

export type AgentAccessScope = (typeof AGENT_ACCESS_SCOPES)[number];
export type AgentAccessExpiration = "7d" | "30d" | "90d" | "never";

interface TokenRow {
  id: string;
  name: string;
  token_hash: string;
  token_hint: string;
  scopes_json: string;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface AgentAccessTokenRecord {
  id: string;
  name: string;
  tokenHint: string;
  scopes: AgentAccessScope[];
  canvasIds: string[];
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface VerifiedAgentAccessToken extends AgentAccessTokenRecord {
  hasScope(scope: AgentAccessScope): boolean;
}

const EXPIRATION_DAYS: Record<Exclude<AgentAccessExpiration, "never">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeHashEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function parseScopes(raw: string): AgentAccessScope[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((scope): scope is AgentAccessScope =>
      (AGENT_ACCESS_SCOPES as readonly string[]).includes(String(scope)),
    );
  } catch {
    return [];
  }
}

function resolveExpiresAt(
  expiration: AgentAccessExpiration,
  now: Date,
): string | null {
  if (expiration === "never") return null;
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + EXPIRATION_DAYS[expiration]);
  return expiresAt.toISOString();
}

function hasEffectiveScope(
  scopes: readonly AgentAccessScope[],
  required: AgentAccessScope,
): boolean {
  if (scopes.includes(required)) return true;
  return required === "canvas:read" && scopes.includes("canvas:write");
}

class AgentAccessTokenStore {
  private getCanvasIds(tokenId: string): string[] {
    const rows = getDb()
      .prepare(
        "SELECT canvas_id FROM agent_access_token_canvases WHERE token_id = ? ORDER BY canvas_id",
      )
      .all(tokenId) as Array<{ canvas_id: string }>;
    return rows.map((row) => row.canvas_id);
  }

  private toRecord(row: TokenRow): AgentAccessTokenRecord {
    return {
      id: row.id,
      name: row.name,
      tokenHint: row.token_hint,
      scopes: parseScopes(row.scopes_json),
      canvasIds: this.getCanvasIds(row.id),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    };
  }

  create(input: {
    name: string;
    scopes: AgentAccessScope[];
    canvasIds: string[];
    expiration: AgentAccessExpiration;
    now?: Date;
  }): { token: string; record: AgentAccessTokenRecord } {
    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const token = `acv1_${id}_${secret}`;
    const now = input.now ?? new Date();
    const createdAt = now.toISOString();
    const expiresAt = resolveExpiresAt(input.expiration, now);
    const scopes = Array.from(new Set(input.scopes));
    const canvasIds = Array.from(new Set(input.canvasIds));

    getDb().transaction(() => {
      getDb()
        .prepare(
          `INSERT INTO agent_access_tokens (
            id, name, token_hash, token_hint, scopes_json,
            expires_at, created_at, revoked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          input.name.trim(),
          hashToken(token),
          `acv1_…${secret.slice(-6)}`,
          JSON.stringify(scopes),
          expiresAt,
          createdAt,
        );
      const insertCanvas = getDb().prepare(
        "INSERT INTO agent_access_token_canvases (token_id, canvas_id) VALUES (?, ?)",
      );
      for (const canvasId of canvasIds) insertCanvas.run(id, canvasId);
    })();

    const record = this.getById(id);
    if (!record) throw new Error("建立 AI 存取 Token 後找不到資料");
    return { token, record };
  }

  list(): AgentAccessTokenRecord[] {
    const rows = getDb()
      .prepare(
        "SELECT * FROM agent_access_tokens ORDER BY created_at DESC, id DESC",
      )
      .all() as TokenRow[];
    return rows.map((row) => this.toRecord(row));
  }

  getById(id: string): AgentAccessTokenRecord | undefined {
    const row = getDb()
      .prepare("SELECT * FROM agent_access_tokens WHERE id = ?")
      .get(id) as TokenRow | null;
    return row ? this.toRecord(row) : undefined;
  }

  revoke(id: string, now = new Date()): boolean {
    const result = getDb()
      .prepare(
        "UPDATE agent_access_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
      )
      .run(now.toISOString(), id);
    return result.changes > 0;
  }

  grantCanvas(tokenId: string, canvasId: string): void {
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO agent_access_token_canvases (token_id, canvas_id) VALUES (?, ?)",
      )
      .run(tokenId, canvasId);
  }

  verify(rawToken: string, now = new Date()): VerifiedAgentAccessToken | null {
    const match = /^acv1_([0-9a-f-]{36})_[A-Za-z0-9_-]+$/i.exec(rawToken);
    if (!match) return null;
    const row = getDb()
      .prepare("SELECT * FROM agent_access_tokens WHERE id = ?")
      .get(match[1]) as TokenRow | null;
    if (!row || row.revoked_at) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) {
      return null;
    }
    if (!safeHashEquals(hashToken(rawToken), row.token_hash)) return null;

    const record = this.toRecord(row);
    return {
      ...record,
      hasScope: (scope) => hasEffectiveScope(record.scopes, scope),
    };
  }

  resolveBearer(req: Request): VerifiedAgentAccessToken | null {
    const authorization = req.headers.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    return match ? this.verify(match[1]) : null;
  }
}

export const agentAccessTokenStore = new AgentAccessTokenStore();
