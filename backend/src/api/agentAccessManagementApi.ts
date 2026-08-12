import { strToU8, zipSync } from "fflate";
import { HTTP_STATUS } from "../constants.js";
import { getDb } from "../database/index.js";
import { authAccessService } from "../services/auth/authAccessService.js";
import { handshakeAuthService } from "../services/auth/handshakeAuthService.js";
import { canvasStore } from "../services/canvasStore.js";
import {
  AGENT_ACCESS_SCOPES,
  agentAccessTokenStore,
  type AgentAccessExpiration,
  type AgentAccessScope,
} from "../services/agentAccess/agentAccessTokenStore.js";
import { jsonResponse, requireJsonBody } from "./apiHelpers.js";

const EXPIRATIONS = new Set<AgentAccessExpiration>([
  "7d",
  "30d",
  "90d",
  "never",
]);

function getAdvertisedUrl(): string | null {
  const row = getDb()
    .prepare("SELECT value FROM global_settings WHERE key = ?")
    .get("agent_access_advertised_url") as { value: string } | null;
  return row?.value ?? null;
}

function setAdvertisedUrl(value: string | null): void {
  if (value === null) {
    getDb()
      .prepare("DELETE FROM global_settings WHERE key = ?")
      .run("agent_access_advertised_url");
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO global_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run("agent_access_advertised_url", value);
}

function defaultApiBaseUrl(req: Request): string {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0];
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0];
  return `${forwardedProto?.trim() || url.protocol.replace(":", "")}://${
    forwardedHost?.trim() || url.host
  }`;
}

function resolveApiBaseUrl(req: Request): string {
  return getAdvertisedUrl() ?? defaultApiBaseUrl(req);
}

function isScope(value: unknown): value is AgentAccessScope {
  return (
    typeof value === "string" &&
    (AGENT_ACCESS_SCOPES as readonly string[]).includes(value)
  );
}

function isNonEmptyArrayOf<T>(
  value: unknown,
  isItem: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.length > 0 && value.every(isItem);
}

export async function handleAgentAccessInfo(req: Request): Promise<Response> {
  const defaultUrl = defaultApiBaseUrl(req);
  return jsonResponse(
    {
      apiBaseUrl: resolveApiBaseUrl(req),
      defaultApiBaseUrl: defaultUrl,
      advertisedUrl: getAdvertisedUrl(),
    },
    HTTP_STATUS.OK,
  );
}

export async function handleAgentAccessSettingsUpdate(
  req: Request,
): Promise<Response> {
  const formatError = requireJsonBody(req);
  if (formatError) return formatError;
  const body = (await req.json().catch(() => null)) as {
    advertisedUrl?: unknown;
  } | null;
  if (!body || !("advertisedUrl" in body)) {
    return jsonResponse(
      { error: "advertisedUrl 為必填" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  if (body.advertisedUrl === null || body.advertisedUrl === "") {
    setAdvertisedUrl(null);
    return handleAgentAccessInfo(req);
  }
  if (typeof body.advertisedUrl !== "string") {
    return jsonResponse(
      { error: "Advertised URL 格式不正確" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  let url: URL;
  try {
    url = new URL(body.advertisedUrl);
  } catch {
    return jsonResponse(
      { error: "Advertised URL 必須是完整的 HTTP 或 HTTPS URL" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || !url.host) {
    return jsonResponse(
      { error: "Advertised URL 必須是完整的 HTTP 或 HTTPS URL" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  setAdvertisedUrl(url.toString().replace(/\/$/, ""));
  return handleAgentAccessInfo(req);
}

export async function handleAgentAccessTokenList(): Promise<Response> {
  return jsonResponse(
    {
      tokens: agentAccessTokenStore
        .list()
        .filter((token) => token.revokedAt === null),
      canvases: canvasStore.list(),
    },
    HTTP_STATUS.OK,
  );
}

export async function handleAgentAccessTokenCreate(
  req: Request,
): Promise<Response> {
  const formatError = requireJsonBody(req);
  if (formatError) return formatError;
  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    scopes?: unknown;
    canvasIds?: unknown;
    expiration?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const expiration = body?.expiration ?? "90d";
  if (
    !body ||
    !name ||
    name.length > 100 ||
    !isNonEmptyArrayOf(body.scopes, isScope) ||
    !isNonEmptyArrayOf(
      body.canvasIds,
      (canvasId): canvasId is string => typeof canvasId === "string",
    ) ||
    typeof expiration !== "string" ||
    !EXPIRATIONS.has(expiration as AgentAccessExpiration)
  ) {
    return jsonResponse({ error: "Token 設定格式不正確" }, HTTP_STATUS.BAD_REQUEST);
  }

  const { scopes, canvasIds } = body;
  const sessionId = handshakeAuthService.resolveRequestSessionId(req);
  for (const canvasId of new Set(canvasIds)) {
    const canvas = canvasStore.getById(canvasId);
    if (!canvas) {
      return jsonResponse({ error: "指定的 Canvas 不存在" }, HTTP_STATUS.BAD_REQUEST);
    }
    if (
      canvas.isProtected &&
      !authAccessService.isCanvasAccessibleAssumingWorkspace(sessionId, canvasId)
    ) {
      return jsonResponse(
        { error: "受保護的 Canvas 必須先在目前瀏覽器解鎖" },
        HTTP_STATUS.FORBIDDEN,
      );
    }
  }

  const created = agentAccessTokenStore.create({
    name,
    scopes,
    canvasIds,
    expiration: expiration as AgentAccessExpiration,
  });
  return jsonResponse(created, HTTP_STATUS.CREATED);
}

export async function handleAgentAccessTokenRevoke(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  if (!agentAccessTokenStore.revoke(params.tokenId ?? "")) {
    return jsonResponse({ error: "找不到可撤銷的 Token" }, HTTP_STATUS.NOT_FOUND);
  }
  return jsonResponse({ success: true }, HTTP_STATUS.OK);
}

export function buildSkillFiles(apiBaseUrl: string): Record<string, Uint8Array> {
  const skill = `---
name: operate-agent-canvas
description: Create, inspect, edit, and run authorized Agent Canvas workflows through the versioned REST API. Use when a user asks to draft or operate an Agent Canvas workflow.
---

# Operate Agent Canvas

Base URL: \`${apiBaseUrl}\`

## Connection setup

Use \`AGENT_CANVAS_BASE_URL\` when it is set; otherwise use the Base URL above.
Read the credential from \`AGENT_CANVAS_TOKEN\`. Send it as
\`Authorization: Bearer <token>\`; for requests with a body, also send
\`Content-Type: application/json\`.

If \`AGENT_CANVAS_TOKEN\` is missing, do not ask the user to paste it into the
conversation. Tell the user to:

1. Open Agent Canvas → Management Center → AI Access.
2. Confirm the advertised URL, then create a least-privilege Token with the
   required scopes and Canvas grants.
3. Store these values in the AI client's secret or environment settings:

   \`AGENT_CANVAS_BASE_URL=${apiBaseUrl}\`
   \`AGENT_CANVAS_TOKEN=<the token shown once by Agent Canvas>\`

4. Restart or relaunch the AI client if it does not inherit new environment
   variables, then retry the request.

When the client has no secret settings, explain that it can be launched from a
shell where the variables are exported. Never echo the Token, place it in a
command argument, commit it, or write it into the Skill. A 401 means the user
must check, recreate, or replace the Token; never request a workspace or Canvas
password.

Read only the reference needed for the current operation:

- Canvas creation, drafts, structure, and Connections: \`references/canvas.md\`
- Pod settings and resource bindings: \`references/pod.md\`
- Workflow discovery and Runs: \`references/workflow.md\`

Scopes:

- \`canvas:read\`: read granted Canvases and discover resources.
- \`canvas:create\`: create a Canvas or complete draft.
- \`canvas:write\`: edit Pods and Connections; also implies \`canvas:read\`.
- \`canvas:execute\`: discover Workflows and start, inspect, or stop Runs.

1. Translate the request into human-equivalent Canvas operations.
2. Read existing state before editing. A token with \`canvas:write\` also permits reads.
3. For a new draft, create a new Canvas; never overwrite an existing Canvas as the draft target.
4. Prefer a minimal workflow of 2–6 single-responsibility Pods. Add branches only when needed.
5. Keep the global provider/model defaults unless the user explicitly requests a supported alternative.
6. Bind repositories, skills, MCP servers, or integrations only when explicitly requested.
7. If details are missing, make conservative assumptions and report them after creating the draft. Ask only when no usable workflow can be formed.
8. Do not attempt deletion endpoints. Stopping a running Run deletes that Run using the same semantics as the human UI.
9. Never expose or write the bearer token into Canvas content, Pod prompts, logs, or shared files.
`;
  const canvas = `# Canvas operations

Use this reference for Canvas discovery and creation, complete drafts, and
Connection structure. IDs are opaque strings.

## Canvas request and response

- \`GET /api/v1/canvases\` returns \`{ "canvases": Canvas[] }\` for granted
  Canvases only. Requires \`canvas:read\`.
- \`GET /api/v1/canvases/{canvasId}\` returns
  \`{ "canvas": Canvas, "pods": Pod[], "connections": Connection[] }\`.
  Requires \`canvas:read\` and a Canvas grant.
- \`POST /api/v1/canvases\` accepts \`{ "name": string }\` and returns
  \`{ "canvas": Canvas }\` with HTTP 201. Requires \`canvas:create\`.

A Canvas created by a token is added to that token's grants. Other newly created
Canvases are never granted automatically.

## Draft request and response

\`POST /api/v1/drafts\` requires \`canvas:create\` and atomically creates a new
Canvas with its Pods and Connections. It never updates an existing Canvas.

\`\`\`json
{
  "name": "Research and summarize",
  "assumptions": ["The final output should be concise."],
  "pods": [
    { "key": "research", "name": "Research", "x": 80, "y": 120 },
    { "key": "summary", "name": "Summarize", "x": 420, "y": 120 }
  ],
  "connections": [
    {
      "sourcePodId": "research",
      "targetPodId": "summary",
      "sourceAnchor": "right",
      "targetAnchor": "left",
      "triggerMode": "auto"
    }
  ]
}
\`\`\`

Each Pod may declare a unique \`key\`; draft Connection IDs may refer to those
keys. If omitted, the Pod's zero-based array index as a string is its key. The
response is \`{ "canvas": Canvas, "pods": Pod[], "connections": Connection[],
"assumptions": string[] }\` with HTTP 201. Return assumptions to the user.

See \`pod.md\` for fields accepted by each object in \`pods\`.

## Connection request and response

- \`GET /api/v1/canvases/{canvasId}/connections\` returns
  \`{ "connections": Connection[] }\`.
- \`POST /api/v1/canvases/{canvasId}/connections\` requires
  \`sourcePodId\` and \`targetPodId\`; it returns \`{ "connection": Connection }\`
  with HTTP 201.
- \`PATCH /api/v1/canvases/{canvasId}/connections/{connectionId}\` returns the
  target \`connection\` and all affected sibling \`connections\`.

Create accepts optional \`sourceAnchor\`, \`targetAnchor\`, \`triggerMode\`,
\`direct\`, \`label\`, \`description\`, and summary/branch provider, model, and
thinking fields. PATCH accepts trigger, direct, label, description, and
summary/branch settings, but does not change source, target, or anchors. Trigger
modes are \`auto\`, \`branch\`, and \`direct\`.

Concurrent edits use last-write-wins. Read current state before a targeted
update. There are no Canvas, Pod, or Connection delete endpoints.

Errors: 400 malformed request; 401 invalid token; 403 missing scope or grant;
404 missing object; 409 state conflict; 422 invalid fields.
`;
  const pod = `# Pod operations

Use this reference for listing, creating, moving, configuring, and binding
resources to Pods on a granted Canvas.

## Pod request and response

- \`GET /api/v1/canvases/{canvasId}/pods\` returns \`{ "pods": Pod[] }\` and
  requires \`canvas:read\`.
- \`POST /api/v1/canvases/{canvasId}/pods\` returns \`{ "pod": Pod }\` with
  HTTP 201 and requires \`canvas:write\`.
- \`PATCH /api/v1/canvases/{canvasId}/pods/{podId}\` returns
  \`{ "pod": Pod }\` and requires \`canvas:write\`.

Create requires \`name\`, \`x\`, and \`y\`. Optional fields are:

- Layout and goal: \`rotation\`, \`goal\`, \`schedule\`.
- Provider: \`provider\`, \`providerConfig\`, \`fastModeEnabled\`.
- Bindings: \`repositoryId\`, \`pluginIds\`, \`mcpServerNames\`,
  \`integrationBindings\`, \`agentCanvasMcpEnabled\`.

PATCH accepts the same fields, including \`x\` and \`y\` for movement. Omitted
fields remain unchanged. \`key\` is accepted only for Pods inside a draft.

Example create request:

\`\`\`json
{
  "name": "Summarize",
  "x": 420,
  "y": 120,
  "goal": {
    "todos": [{ "id": "write", "text": "Write a concise summary" }]
  }
}
\`\`\`

## Resource request and response

Discover identifiers before binding them:

- \`GET /api/v1/resources/providers\`
- \`GET /api/v1/resources/repositories\`
- \`GET /api/v1/resources/skills\`
- \`GET /api/v1/resources/mcp\`
- \`GET /api/v1/resources/integrations\`

These endpoints require \`canvas:read\` and return identifiers plus non-secret
metadata. Only connected Integrations and enabled MCP servers can be bound.
Bind a Repository, Skill, MCP, or Integration only when explicitly requested.

Errors: 401 invalid token; 403 missing scope or grant; 404 missing Pod; 409 state
conflict; 422 invalid fields or resource binding.
`;
  const workflow = `# Workflow and Run operations

Use this reference to discover executable entry Pods and start, inspect, or stop
Runs. All endpoints require \`canvas:execute\` and a Canvas grant.

## Workflow request and response

\`GET /api/v1/canvases/{canvasId}/workflows\` returns:

\`\`\`json
{
  "workflows": [
    { "podId": "...", "name": "Research", "kind": "workflow" },
    { "podId": "...", "name": "Standalone task", "kind": "independent" }
  ]
}
\`\`\`

Only Pods with no incoming Connection are executable entry points. \`workflow\`
means the Pod has downstream Connections; \`independent\` means it has none.
Never start an intermediate Pod by ID.

## Start Run request and response

\`POST /api/v1/canvases/{canvasId}/workflows/{podId}/runs\` accepts:

\`\`\`json
{ "message": "Perform the requested workflow." }
\`\`\`

It starts asynchronously and immediately returns HTTP 202:

\`\`\`json
{ "accepted": true, "runId": "..." }
\`\`\`

Do not wait for output or poll unless the user needs status.

## Run status and stop response

- \`GET /api/v1/canvases/{canvasId}/runs/{runId}\` returns the Run's status and
  minimal Pod instance status; it does not expose complete prompts or output.
- \`DELETE /api/v1/canvases/{canvasId}/runs/{runId}\` is valid only while the Run
  is running. It stops and deletes the Run using the same semantics as the human
  UI, then returns \`{ "success": true, "runId": string }\`.

There is no endpoint to delete completed Run history.

Errors: 401 invalid token; 403 missing scope or grant; 404 missing Run; 409 the
Pod is not an entry point or the Run is no longer running; 422 invalid request.
`;
  return {
    "operate-agent-canvas/SKILL.md": strToU8(skill),
    "operate-agent-canvas/references/canvas.md": strToU8(canvas),
    "operate-agent-canvas/references/pod.md": strToU8(pod),
    "operate-agent-canvas/references/workflow.md": strToU8(workflow),
  };
}

export async function handleAgentAccessSkillDownload(
  req: Request,
): Promise<Response> {
  const archive = zipSync(buildSkillFiles(resolveApiBaseUrl(req)), { level: 6 });
  return new Response(archive, {
    status: HTTP_STATUS.OK,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="agent-canvas-skill.zip"',
      "Cache-Control": "no-store",
    },
  });
}
