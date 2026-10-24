/** Shared test helpers: in-memory MCP client and a stubbed fetch. */
import { vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type CreateServerOptions } from "../src/server.js";

export const TEST_TOKEN = "apify_api_TEST";
export const TEST_API_BASE = "http://apify.test/v2";

export interface MockRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface FetchMock {
  calls: MockRequest[];
  fn: ReturnType<typeof vi.fn>;
  /** Requests made with the given HTTP method. */
  of(method: string): MockRequest[];
  /** The single request whose URL contains the given fragment. */
  find(fragment: string): MockRequest;
}

/** Replace global fetch with a deterministic handler that records requests. */
export function installFetchMock(
  handler: (request: MockRequest) => MockResponse | Promise<MockResponse>,
): FetchMock {
  const calls: MockRequest[] = [];
  const fn = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as Request).url);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(init.headers ?? {})) {
      headers[key.toLowerCase()] = String(value);
    }
    let body: unknown;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const request: MockRequest = {
      url,
      method: (init.method ?? "GET").toUpperCase(),
      headers,
      body,
    };
    calls.push(request);
    const response = await handler(request);
    const text = response.body === undefined ? "" : JSON.stringify(response.body);
    return new Response(text, {
      status: response.status ?? 200,
      headers: { "content-type": "application/json", ...(response.headers ?? {}) },
    });
  });
  vi.stubGlobal("fetch", fn);
  return {
    calls,
    fn,
    of: (method) => calls.filter((call) => call.method === method.toUpperCase()),
    find: (fragment) => {
      const match = calls.find((call) => call.url.includes(fragment));
      if (!match) throw new Error(`No request matching "${fragment}"`);
      return match;
    },
  };
}

export interface TestClient {
  client: Client;
  close(): Promise<void>;
}

/** Connect an MCP client to the server over an in-memory transport. */
export async function connectTestClient(
  options: CreateServerOptions = {},
): Promise<TestClient> {
  const server = createServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** Text content of a CallToolResult. */
export function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content.find((item) => item.type === "text");
  return block?.text ?? "";
}

/** Parse the JSON text payload of a successful CallToolResult. */
export function jsonOf<T = Record<string, unknown>>(result: {
  content: Array<{ type: string; text?: string }>;
}): T {
  return JSON.parse(textOf(result)) as T;
}

export function runObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "run_1",
    actId: "act_1",
    status: "RUNNING",
    statusMessage: "Actor is running",
    defaultDatasetId: "ds_1",
    ...overrides,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Standard happy-path Apify mock: run -> poll -> dataset metadata -> items. */
export function happyPathHandler(options: {
  status?: string;
  itemCount?: number;
  items?: unknown[];
  statusMessage?: string;
  poll?: "done" | "running-forever";
}) {
  const status = options.status ?? "SUCCEEDED";
  const itemCount = options.itemCount ?? 3;
  const items = options.items ?? [{ n: 1 }, { n: 2 }, { n: 3 }];
  return (request: MockRequest): MockResponse | Promise<MockResponse> => {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/runs") && request.method === "POST") {
      return { status: 201, body: { data: runObject({ status: "RUNNING" }) } };
    }
    if (url.pathname === "/v2/actor-runs/run_1") {
      if (options.poll === "running-forever") {
        return sleep(25).then(() => ({
          body: { data: runObject({ status: "RUNNING" }) },
        }));
      }
      return {
        body: { data: runObject({ status, statusMessage: options.statusMessage ?? status }) },
      };
    }
    if (url.pathname === "/v2/datasets/ds_1") {
      return { body: { data: { id: "ds_1", itemCount } } };
    }
    if (url.pathname === "/v2/datasets/ds_1/items") {
      const limit = Number(url.searchParams.get("limit") ?? items.length);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return { body: items.slice(offset, offset + limit) };
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  };
}
