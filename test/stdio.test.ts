/**
 * End-to-end stdio round trip: spawn the built server, point it at a local
 * mock Apify API with SUBIMPACT_API_BASE, and drive it with the MCP SDK client.
 */
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const requests: CapturedRequest[] = [];
let httpServer: HttpServer;
let apiBase: string;

function respond(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

beforeAll(async () => {
  httpServer = createHttpServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        headers: request.headers,
        body,
      });
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const run = {
        id: "run_live",
        actId: "act_1",
        status: "SUCCEEDED",
        statusMessage: "Actor finished",
        defaultDatasetId: "ds_live",
      };
      if (request.method === "POST" && url.pathname.endsWith("/runs")) {
        respond(response, 201, { data: { ...run, status: "RUNNING" } });
      } else if (url.pathname === "/v2/actor-runs/run_live") {
        respond(response, 200, { data: run });
      } else if (url.pathname === "/v2/datasets/ds_live") {
        respond(response, 200, { data: { id: "ds_live", itemCount: 1 } });
      } else if (url.pathname === "/v2/datasets/ds_live/items") {
        respond(response, 200, [
          {
            query: "best crm for startups",
            aiOverview: { answer: "Mock AI Overview answer" },
          },
        ]);
      } else {
        respond(response, 404, { error: { message: "not found" } });
      }
    });
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = httpServer.address() as AddressInfo;
  apiBase = `http://127.0.0.1:${address.port}/v2`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => (error ? reject(error) : resolve()));
  });
});

function serverEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    APIFY_TOKEN: "apify_api_TEST",
    SUBIMPACT_API_BASE: apiBase,
    SUBIMPACT_TIMEOUT_SECS: "5",
    ...extra,
  };
}

async function connect(args: string[] = []): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js", ...args],
    env: serverEnv(),
    stderr: "pipe",
  });
  const client = new Client({ name: "stdio-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("stdio round trip", () => {
  test("lists 20 tools and calls google_search against a mocked Apify API", async () => {
    expect(existsSync("dist/index.js")).toBe(true);
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(20);

      const result = await client.callTool({
        name: "google_search",
        arguments: { queries: ["best crm for startups"], _maxItems: 1, _maxChargeUsd: 0.1 },
      });
      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(
        (result.content as Array<{ type: string; text?: string }>).find(
          (item) => item.type === "text",
        )!.text!,
      ) as Record<string, any>;
      expect(payload.actor).toBe("subimpact/google-serp-ai-overviews");
      expect(payload.runId).toBe("run_live");
      expect(payload.status).toBe("SUCCEEDED");
      expect(payload.returned).toBe(1);
      expect(payload.items[0].query).toBe("best crm for startups");

      const post = requests.find((request) => request.method === "POST")!;
      expect(new URL(post.url, "http://127.0.0.1").searchParams.get("maxTotalChargeUsd")).toBe(
        "0.1",
      );
      expect(JSON.parse(post.body)).toEqual({ queries: ["best crm for startups"] });
      expect(post.headers.authorization).toBe("Bearer apify_api_TEST");
      expect(String(post.headers["user-agent"])).toMatch(/^subimpact-data-mcp\//);
    } finally {
      await client.close();
    }
  }, 30_000);

  test("--tools only exposes the requested subset plus get_run_results", async () => {
    const client = await connect(["--tools", "google_search,news_mentions"]);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "get_run_results",
        "google_search",
        "news_mentions",
      ]);
    } finally {
      await client.close();
    }
  }, 30_000);
});
