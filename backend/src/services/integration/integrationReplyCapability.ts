import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import { config } from "../../config/index.js";

const KEY_FILE_NAME = "integration-reply-bridge.key";
const KEY_LENGTH_BYTES = 32;
const TOKEN_VERSION = 1;
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export interface IntegrationReplyCapabilityScope {
  provider: string;
  appId: string;
  resourceId: string;
  podId: string;
  extra: Record<string, unknown>;
  replyContext: Record<string, unknown>;
  issuedAt: number;
  expiresAt: number;
}

interface CapabilityTokenPayload extends IntegrationReplyCapabilityScope {
  version: typeof TOKEN_VERSION;
}

function getKeyFilePath(): string {
  return path.join(config.appDataRoot, KEY_FILE_NAME);
}

function readOrCreateKey(): Buffer {
  const keyPath = getKeyFilePath();
  try {
    const key = fs.readFileSync(keyPath);
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error("Integration reply capability key length is invalid");
    }
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const key = randomBytes(KEY_LENGTH_BYTES);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export function stableJsonStringify(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(object[key])}`)
    .join(",")}}`;
}

function signPayload(payloadBase64: string): string {
  return createHmac("sha256", readOrCreateKey())
    .update(payloadBase64)
    .digest("base64url");
}

export function createIntegrationReplyCapability(
  scope: Omit<IntegrationReplyCapabilityScope, "issuedAt" | "expiresAt">,
  now = Date.now(),
): string {
  const payload: CapabilityTokenPayload = {
    version: TOKEN_VERSION,
    ...scope,
    issuedAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
  };
  const payloadBase64 = base64UrlEncode(stableJsonStringify(payload));
  const signature = signPayload(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

export function verifyIntegrationReplyCapability(
  token: string,
  now = Date.now(),
): IntegrationReplyCapabilityScope {
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) {
    throw new Error("Integration reply capability token 格式不正確");
  }

  const expectedSignature = signPayload(payloadBase64);
  const signatureBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error("Integration reply capability token 簽章不正確");
  }

  const payload = JSON.parse(
    base64UrlDecode(payloadBase64).toString("utf8"),
  ) as Partial<CapabilityTokenPayload>;

  if (payload.version !== TOKEN_VERSION) {
    throw new Error("Integration reply capability token 版本不支援");
  }
  if (
    typeof payload.provider !== "string" ||
    typeof payload.appId !== "string" ||
    typeof payload.resourceId !== "string" ||
    typeof payload.podId !== "string" ||
    typeof payload.issuedAt !== "number" ||
    typeof payload.expiresAt !== "number" ||
    !payload.extra ||
    typeof payload.extra !== "object" ||
    Array.isArray(payload.extra) ||
    !payload.replyContext ||
    typeof payload.replyContext !== "object" ||
    Array.isArray(payload.replyContext)
  ) {
    throw new Error("Integration reply capability token payload 不完整");
  }
  if (payload.expiresAt <= now) {
    throw new Error("Integration reply capability token 已過期");
  }

  return {
    provider: payload.provider,
    appId: payload.appId,
    resourceId: payload.resourceId,
    podId: payload.podId,
    extra: payload.extra as Record<string, unknown>,
    replyContext: payload.replyContext as Record<string, unknown>,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  };
}
