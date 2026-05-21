import {
  closeTestServer,
  createTestServer,
  type TestServerInstance,
} from "../setup/testServer.js";

export interface ApiRequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

export interface ApiResponse<TBody = unknown> {
  response: Response;
  status: number;
  headers: Headers;
  body: TBody;
}

export interface ApiIntegrationClient {
  baseUrl: string;
  canvasId: string;
  request: (path: string, options?: ApiRequestOptions) => Promise<Response>;
  json: <TBody = unknown>(
    path: string,
    options?: ApiRequestOptions,
  ) => Promise<ApiResponse<TBody>>;
  get: <TBody = unknown>(path: string) => Promise<ApiResponse<TBody>>;
  post: <TBody = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, "method" | "body">,
  ) => Promise<ApiResponse<TBody>>;
  patch: <TBody = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, "method" | "body">,
  ) => Promise<ApiResponse<TBody>>;
  delete: <TBody = unknown>(path: string) => Promise<ApiResponse<TBody>>;
}

export interface ApiIntegrationHarness extends ApiIntegrationClient {
  server: TestServerInstance;
  cleanup: () => Promise<void>;
}

function resolveUrl(baseUrl: string, path: string): string {
  return path.startsWith("http://") || path.startsWith("https://")
    ? path
    : new URL(path, baseUrl).toString();
}

function buildRequestInit(options: ApiRequestOptions = {}): RequestInit {
  const headers = new Headers(options.headers);
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
  };

  if (options.body !== undefined) {
    if (
      typeof options.body === "string" ||
      options.body instanceof Blob ||
      options.body instanceof FormData ||
      options.body instanceof ArrayBuffer
    ) {
      init.body = options.body;
    } else {
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      init.body = JSON.stringify(options.body);
    }
  }

  return init;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

export function createApiIntegrationClient(
  server: TestServerInstance,
): ApiIntegrationClient {
  const request = (path: string, options?: ApiRequestOptions) =>
    fetch(resolveUrl(server.baseUrl, path), buildRequestInit(options));

  const json = async <TBody = unknown>(
    path: string,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse<TBody>> => {
    const response = await request(path, options);
    const body = (await readResponseBody(response)) as TBody;

    return {
      response,
      status: response.status,
      headers: response.headers,
      body,
    };
  };

  return {
    baseUrl: server.baseUrl,
    canvasId: server.canvasId,
    request,
    json,
    get: (path) => json(path),
    post: (path, body, options) =>
      json(path, { ...options, method: "POST", body }),
    patch: (path, body, options) =>
      json(path, { ...options, method: "PATCH", body }),
    delete: (path) => json(path, { method: "DELETE" }),
  };
}

export async function createApiIntegrationHarness(): Promise<ApiIntegrationHarness> {
  const server = await createTestServer();
  const client = createApiIntegrationClient(server);

  return {
    ...client,
    server,
    cleanup: () => closeTestServer(server),
  };
}
