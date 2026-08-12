import { getApiBaseUrl } from "@/services/utils";

export type AgentAccessScope =
  | "canvas:read"
  | "canvas:create"
  | "canvas:write"
  | "canvas:execute";
export type AgentAccessExpiration = "7d" | "30d" | "90d" | "never";

export interface AgentAccessInfo {
  apiBaseUrl: string;
  defaultApiBaseUrl: string;
  advertisedUrl: string | null;
}

export interface AgentAccessCanvas {
  id: string;
  name: string;
  isProtected: boolean;
}

export interface AgentAccessToken {
  id: string;
  name: string;
  tokenHint: string;
  scopes: AgentAccessScope[];
  canvasIds: string[];
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

async function apiJson<T>(
  path: string,
  init?: Parameters<typeof fetch>[1],
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  return body;
}

export function getAgentAccessInfo(): Promise<AgentAccessInfo> {
  return apiJson("/api/ai-access");
}

export function updateAgentAccessSettings(
  advertisedUrl: string | null,
): Promise<AgentAccessInfo> {
  return apiJson("/api/ai-access", {
    method: "PATCH",
    body: JSON.stringify({ advertisedUrl }),
  });
}

export function listAgentAccessTokens(): Promise<{
  tokens: AgentAccessToken[];
  canvases: AgentAccessCanvas[];
}> {
  return apiJson("/api/ai-access/tokens");
}

export function createAgentAccessToken(input: {
  name: string;
  scopes: AgentAccessScope[];
  canvasIds: string[];
  expiration: AgentAccessExpiration;
}): Promise<{ token: string; record: AgentAccessToken }> {
  return apiJson("/api/ai-access/tokens", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function revokeAgentAccessToken(tokenId: string): Promise<void> {
  return apiJson(`/api/ai-access/tokens/${encodeURIComponent(tokenId)}`, {
    method: "DELETE",
  }).then(() => undefined);
}

export async function downloadAgentCanvasSkill(): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/ai-access/skill`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "agent-canvas.zip";
  anchor.click();
  URL.revokeObjectURL(url);
}
