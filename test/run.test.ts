import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  TEST_API_BASE,
  TEST_TOKEN,
  connectTestClient,
  happyPathHandler,
  installFetchMock,
  jsonOf,
  runObject,
  textOf,
} from "./helpers.js";

beforeEach(() => {
  vi.stubEnv("APIFY_TOKEN", TEST_TOKEN);
  vi.stubEnv("SUBIMPACT_API_BASE", TEST_API_BASE);
  vi.stubEnv("SUBIMPACT_TIMEOUT_SECS", "5");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("happy path", () => {
  test("starts the run, polls, returns dataset items and a truncation note", async () => {
    const fetchMock = installFetchMock(
      happyPathHandler({ itemCount: 3, items: [{ n: 1 }, { n: 2 }] }),
    );
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "google_search",
        arguments: { queries: ["best crm"], _maxItems: 2 },
      });
      expect(result.isError).toBeFalsy();

      const payload = jsonOf<Record<string, any>>(result);
      expect(payload.actor).toBe("subimpact/google-serp-ai-overviews");
      expect(payload.runId).toBe("run_1");
      expect(payload.status).toBe("SUCCEEDED");
      expect(payload.statusMessage).toBe("SUCCEEDED");
      expect(payload.itemCount).toBe(3);
      expect(payload.returned).toBe(2);
      expect(payload.items).toEqual([{ n: 1 }, { n: 2 }]);
      expect(payload.consoleUrl).toBe("https://console.apify.com/view/runs/run_1");
      expect(payload.note).toContain("Showing dataset items 1-2 of 3");

      const itemsCall = fetchMock.find("/datasets/ds_1/items");
      const itemsUrl = new URL(itemsCall.url);
      expect(itemsUrl.searchParams.get("clean")).toBe("true");
      expect(itemsUrl.searchParams.get("limit")).toBe("2");
      expect(itemsUrl.searchParams.get("offset")).toBe("0");

      const poll = fetchMock.find("/actor-runs/run_1");
      expect(new URL(poll.url).searchParams.get("waitForFinish")).toBe("5");
    } finally {
      await close();
    }
  });

  test("omits the note when nothing was truncated", async () => {
    installFetchMock(happyPathHandler({ itemCount: 2, items: [{ n: 1 }, { n: 2 }] }));
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "google_jobs",
        arguments: { queries: ["barista jobs singapore"] },
      });
      const payload = jsonOf<Record<string, any>>(result);
      expect(payload.returned).toBe(2);
      expect(payload.itemCount).toBe(2);
      expect(payload).not.toHaveProperty("note");
    } finally {
      await close();
    }
  });
});

describe("long-running jobs", () => {
  test("returns a runId when the budget runs out", async () => {
    vi.stubEnv("SUBIMPACT_TIMEOUT_SECS", "0.6");
    const fetchMock = installFetchMock(happyPathHandler({ poll: "running-forever" }));
    const { client, close } = await connectTestClient();
    try {
      const started = Date.now();
      const result = await client.callTool({
        name: "youtube",
        arguments: { searchQueries: ["python tutorial"] },
      });
      expect(Date.now() - started).toBeLessThan(5000);
      expect(result.isError).toBeFalsy();

      const payload = jsonOf<Record<string, any>>(result);
      expect(payload.runId).toBe("run_1");
      expect(payload.status).toBe("RUNNING");
      expect(payload.note).toBe("still running; call get_run_results with this runId");
      expect(payload.consoleUrl).toBe("https://console.apify.com/view/runs/run_1");
      expect(payload).not.toHaveProperty("items");

      expect(fetchMock.calls.length).toBeGreaterThan(2);
      for (const call of fetchMock.calls.filter((item) => item.url.includes("/actor-runs/"))) {
        expect(Number(new URL(call.url).searchParams.get("waitForFinish"))).toBeLessThanOrEqual(1);
      }
    } finally {
      await close();
    }
  });

  test("get_run_results fetches status and items for a finished run", async () => {
    const fetchMock = installFetchMock(
      happyPathHandler({ status: "SUCCEEDED", itemCount: 5, items: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }] }),
    );
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "get_run_results",
        arguments: { runId: "run_1", _maxItems: 2, offset: 1 },
      });
      expect(result.isError).toBeFalsy();

      const payload = jsonOf<Record<string, any>>(result);
      expect(payload.runId).toBe("run_1");
      expect(payload.status).toBe("SUCCEEDED");
      expect(payload.itemCount).toBe(5);
      expect(payload.returned).toBe(2);
      expect(payload.offset).toBe(1);
      expect(payload.items).toEqual([{ n: 2 }, { n: 3 }]);
      expect(payload.note).toContain("Showing dataset items 2-3 of 5");

      const itemsUrl = new URL(fetchMock.find("/items").url);
      expect(itemsUrl.searchParams.get("offset")).toBe("1");
      expect(itemsUrl.searchParams.get("limit")).toBe("2");
    } finally {
      await close();
    }
  });

  test("get_run_results reports a still-running run", async () => {
    installFetchMock(
      happyPathHandler({ poll: "running-forever" }),
    );
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "get_run_results",
        arguments: { runId: "run_1" },
      });
      const payload = jsonOf<Record<string, any>>(result);
      expect(payload.status).toBe("RUNNING");
      expect(payload.note).toBe("still running; call get_run_results with this runId");
    } finally {
      await close();
    }
  });

  test("get_run_results requires a runId", async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({ name: "get_run_results", arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("runId is required");
    } finally {
      await close();
    }
  });
});

describe("failed runs", () => {
  test("FAILED runs return isError with the statusMessage", async () => {
    installFetchMock(
      happyPathHandler({ status: "FAILED", statusMessage: "Actor failed: upstream 503" }),
    );
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "google_search",
        arguments: { queries: ["x"] },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("FAILED");
      expect(textOf(result)).toContain("Actor failed: upstream 503");
      expect(textOf(result)).toContain("https://console.apify.com/view/runs/run_1");
    } finally {
      await close();
    }
  });

  test("TIMED-OUT runs return isError", async () => {
    installFetchMock(
      happyPathHandler({ status: "TIMED-OUT", statusMessage: "Run timed out" }),
    );
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "google_search",
        arguments: { queries: ["x"] },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("TIMED-OUT");
    } finally {
      await close();
    }
  });

  test("get_run_results maps failed runs to isError", async () => {
    installFetchMock(happyPathHandler({ status: "ABORTED", statusMessage: "Aborted by user" }));
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "get_run_results",
        arguments: { runId: "run_1" },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("Aborted by user");
    } finally {
      await close();
    }
  });
});

describe("Apify HTTP errors", () => {
  const cases: Array<{
    status: number;
    headers?: Record<string, string>;
    contains: string[];
  }> = [
    { status: 401, contains: ["401", "APIFY_TOKEN", "console.apify.com/settings/integrations"] },
    { status: 402, contains: ["402", "credit"] },
    { status: 403, contains: ["403", "Forbidden"] },
    { status: 429, headers: { "retry-after": "30" }, contains: ["429", "Retry in 30s"] },
  ];

  for (const testCase of cases) {
    test(`maps HTTP ${testCase.status} to a readable isError`, async () => {
      installFetchMock(() => ({
        status: testCase.status,
        headers: testCase.headers,
        body: { error: { type: "invalid-input", message: "mock detail" } },
      }));
      const { client, close } = await connectTestClient();
      try {
        const result = await client.callTool({
          name: "google_search",
          arguments: { queries: ["x"] },
        });
        expect(result.isError).toBe(true);
        const text = textOf(result);
        for (const fragment of testCase.contains) expect(text).toContain(fragment);
        expect(text).toContain("mock detail");
      } finally {
        await close();
      }
    });
  }

  test("network failures are reported without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }));
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "google_search",
        arguments: { queries: ["x"] },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("Could not reach the Apify API");
    } finally {
      await close();
    }
  });
});

describe("run object edge cases", () => {
  test("a run without a default dataset returns a clear error", async () => {
    installFetchMock((request) => {
      const url = new URL(request.url);
      if (request.method === "POST") {
        return {
          status: 201,
          body: { data: runObject({ status: "SUCCEEDED", defaultDatasetId: undefined }) },
        };
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "google_search",
        arguments: { queries: ["x"] },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("no default dataset");
    } finally {
      await close();
    }
  });
});
