import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import { config } from "../../config/index.js";

const KEY_FILE_NAME = "agent-canvas-mcp.key";
const TOKEN_VERSION = 1;
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export interface AgentCanvasCapabilityScope {
  canvasId: string;
  podId: string;
  runId: string;
  permission: "execute";
  issuedAt: number;
  expiresAt: number;
}

function readOrCreateKey(): Buffer {
  const keyPath = path.join(config.appDataRoot, KEY_FILE_NAME);
  try {
    const key = fs.readFileSync(keyPath);
    if (key.length !== 32) throw new Error("Agent Canvas capability 金鑰長度不正確");
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const key = randomBytes(32);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

function sign(payload: string): string {
  return createHmac("sha256", readOrCreateKey()).update(payload).digest("base64url");
}

export function createAgentCanvasCapability(
  scope: Pick<AgentCanvasCapabilityScope, "canvasId" | "podId" | "runId">,
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      version: TOKEN_VERSION,
      ...scope,
      permission: "execute",
      issuedAt: now,
      expiresAt: now + DEFAULT_TTL_MS,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyAgentCanvasCapability(
  token: string,
  now = Date.now(),
): AgentCanvasCapabilityScope {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("Agent Canvas capability 格式不正確");
  const expected = Buffer.from(sign(payload), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Agent Canvas capability 簽章不正確");
  }
  const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as
    Partial<AgentCanvasCapabilityScope> & { version?: unknown };
  if (
    value.version !== TOKEN_VERSION ||
    typeof value.canvasId !== "string" ||
    typeof value.podId !== "string" ||
    typeof value.runId !== "string" ||
    value.permission !== "execute" ||
    typeof value.issuedAt !== "number" ||
    typeof value.expiresAt !== "number"
  ) {
    throw new Error("Agent Canvas capability payload 不完整");
  }
  if (value.expiresAt <= now) throw new Error("Agent Canvas capability 已過期");
  return value as AgentCanvasCapabilityScope;
}
