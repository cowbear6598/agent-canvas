import { vi } from "vitest";

type RouteMatcher =
  | string
  | RegExp
  | ((request: FakeApiRequest) => boolean | Promise<boolean>);

type FakeApiResponseBody =
  | BodyInit
  | Record<string, unknown>
  | unknown[]
  | null
  | undefined;

type FakeApiRouteHandler = (
  request: FakeApiRequest,
) => FakeApiRouteResponse | Response | Promise<FakeApiRouteResponse | Response>;

export interface FakeApiRouteResponse {
  status?: number;
  headers?: HeadersInit;
  body?: FakeApiResponseBody;
}

export interface FakeApiRoute {
  method?: string;
  path: RouteMatcher;
  handler: FakeApiRouteHandler;
}

export interface FakeApiRequest {
  input: RequestInfo | URL;
  init?: RequestInit;
  method: string;
  url: URL;
  path: string;
  headers: Headers;
  bodyText(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface FakeApiServer {
  fetch: ReturnType<typeof vi.fn>;
  requests: FakeApiRequest[];
  route(route: FakeApiRoute): void;
  restore(): void;
}

function createResponse(response: FakeApiRouteResponse | Response): Response {
  if (response instanceof Response) {
    return response;
  }

  const status = response.status ?? 200;
  const headers = new Headers(response.headers);

  if (
    response.body !== undefined &&
    response.body !== null &&
    typeof response.body === "object" &&
    !(response.body instanceof Blob) &&
    !(response.body instanceof FormData) &&
    !(response.body instanceof URLSearchParams) &&
    !(response.body instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(response.body)
  ) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return new Response(JSON.stringify(response.body), { status, headers });
  }

  return new Response(response.body as BodyInit | null | undefined, {
    status,
    headers,
  });
}

function resolveRequestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) {
    return new URL(input.url, window.location.origin);
  }
  return new URL(input as string | URL, window.location.origin);
}

function resolveRequestMethod(
  input: RequestInfo | URL,
  init?: RequestInit,
): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }
  if (input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function resolveRequestHeaders(
  input: RequestInfo | URL,
  init?: RequestInit,
): Headers {
  const headers =
    input instanceof Request ? new Headers(input.headers) : new Headers();
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return headers;
}

function resolveRequestBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): BodyInit | null {
  if (init?.body !== undefined) {
    return init.body;
  }
  if (input instanceof Request) {
    return input.body;
  }
  return null;
}

async function readBodyText(body: BodyInit | null): Promise<string> {
  if (body === null) {
    return "";
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof FormData) {
    return JSON.stringify(Object.fromEntries(body.entries()));
  }
  if (body instanceof Blob) {
    return body.text();
  }
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }
  return "";
}

async function matchesRoute(
  route: FakeApiRoute,
  request: FakeApiRequest,
): Promise<boolean> {
  const method = route.method?.toUpperCase();
  if (method && method !== request.method) {
    return false;
  }

  if (typeof route.path === "string") {
    return route.path === request.path || route.path === request.url.pathname;
  }
  if (route.path instanceof RegExp) {
    return route.path.test(request.path);
  }
  return route.path(request);
}

export function installFakeApiServer(
  routes: FakeApiRoute[] = [],
): FakeApiServer {
  const originalFetch = globalThis.fetch;
  const registeredRoutes = [...routes];
  const requests: FakeApiRequest[] = [];

  const fakeFetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = resolveRequestBody(input, init);
      let bodyText: string | null = null;
      const request: FakeApiRequest = {
        input,
        init,
        method: resolveRequestMethod(input, init),
        url: resolveRequestUrl(input),
        get path() {
          return `${this.url.pathname}${this.url.search}`;
        },
        headers: resolveRequestHeaders(input, init),
        async bodyText() {
          bodyText ??= await readBodyText(body);
          return bodyText;
        },
        async json<T = unknown>() {
          return JSON.parse(await this.bodyText()) as T;
        },
      };

      requests.push(request);

      for (const candidate of registeredRoutes) {
        if (await matchesRoute(candidate, request)) {
          return createResponse(await candidate.handler(request));
        }
      }

      return createResponse({
        status: 404,
        body: {
          error: `No fake API route for ${request.method} ${request.path}`,
        },
      });
    },
  );

  globalThis.fetch = fakeFetch as typeof fetch;

  return {
    fetch: fakeFetch,
    requests,
    route(route: FakeApiRoute): void {
      registeredRoutes.push(route);
    },
    restore(): void {
      globalThis.fetch = originalFetch;
    },
  };
}
