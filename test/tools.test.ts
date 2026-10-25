import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Ajv from "ajv";
import { TOKEN_MISSING_MESSAGE } from "../src/server.js";
import { loadActorSpecs, formatPrice, pricingLine } from "../src/tools.js";
import {
  TEST_API_BASE,
  TEST_TOKEN,
  connectTestClient,
  happyPathHandler,
  installFetchMock,
  textOf,
} from "./helpers.js";

beforeEach(() => {
  vi.stubEnv("APIFY_TOKEN", TEST_TOKEN);
  vi.stubEnv("SUBIMPACT_API_BASE", TEST_API_BASE);
  vi.stubEnv("SUBIMPACT_TIMEOUT_SECS", "5");
  delete process.env.SUBIMPACT_TOOLS;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("tools/list without credentials", () => {
  test("exposes 22 actor tools plus get_run_results and a valid JSON Schema for each", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    const { client, close } = await connectTestClient();
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(23);
      expect(tools.map((tool) => tool.name)).toContain("get_run_results");
      expect(tools.map((tool) => tool.name)).toContain("google_search");
      expect(tools.filter((tool) => tool.name !== "get_run_results")).toHaveLength(22);

      const ajv = new Ajv({ strict: false, validateFormats: false });
      for (const tool of tools) {
        expect(tool.name).toMatch(/^[a-z0-9_]+$/);
        expect(typeof tool.description).toBe("string");
        expect(tool.description?.length ?? 0).toBeGreaterThan(20);
        expect(tool.inputSchema.type).toBe("object");

        const properties = tool.inputSchema.properties as Record<string, any>;
        expect(properties).toBeTruthy();
        expect(properties._maxItems?.type).toBe("integer");
        expect(properties._maxItems?.default).toBe(50);
        expect(properties._maxItems?.maximum).toBe(1000);
        expect(properties._maxChargeUsd?.type).toBe("number");
        expect(properties._maxChargeUsd?.default).toBe(0.5);

        const required = (tool.inputSchema.required ?? []) as string[];
        expect(required).not.toContain("_maxItems");
        expect(required).not.toContain("_maxChargeUsd");

        // Every schema compiles as JSON Schema.
        const validate = ajv.compile(tool.inputSchema);
        expect(typeof validate).toBe("function");

        const serialized = JSON.stringify(tool.inputSchema);
        for (const editorOnly of ["prefill", "enumTitles", "example"]) {
          expect(serialized).not.toContain(`"${editorOnly}"`);
        }
      }
    } finally {
      await close();
    }
  });

  test("keeps actor required inputs and mapped keywords (enum, default, items, minimum, maximum)", async () => {
    const { client, close } = await connectTestClient();
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));

      const news = byName.get("news_mentions")!;
      expect(news.inputSchema.required).toEqual(["keywords"]);
      const regions = (news.inputSchema.properties as Record<string, any>).regions;
      expect(regions.type).toBe("array");
      expect(regions.items.type).toBe("string");
      expect(regions.items.enum).toContain("MY");
      expect(regions.default).toEqual([]);

      const search = byName.get("google_search")!;
      const maxResults = (search.inputSchema.properties as Record<string, any>).maxResults;
      expect(maxResults.type).toBe("integer");
      expect(maxResults.default).toBe(10);

      const maps = byName.get("google_maps_places")!;
      const proxy = (maps.inputSchema.properties as Record<string, any>).proxyConfiguration;
      expect(proxy.type).toBe("object");

      const seo = byName.get("seo_page_audit")!;
      const overrides = (seo.inputSchema.properties as Record<string, any>).serpOverrides;
      expect(overrides.items.properties.url.type).toBe("string");
    } finally {
      await close();
    }
  });

  test("tool descriptions carry title, pricing and the actor name", async () => {
    const { client, close } = await connectTestClient();
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));

      const search = byName.get("google_search")!;
      expect(search.description).toContain("Google SERP + AI Overviews API");
      expect(search.description).toContain("Pricing (pay per event, billed to your Apify account): Google SERP: $0.003");
      expect(search.description).toContain("Runs on Apify as subimpact/google-serp-ai-overviews");
      expect(search.description).not.toContain("platform usage billed to your account");

      const modeTool = byName.get("google_ai_mode")!;
      expect(modeTool.description).toContain("platform usage billed to your account");

      const maps = byName.get("google_maps_places")!;
      expect(maps.description).toContain("$0.00005");

      const getRun = byName.get("get_run_results")!;
      expect(getRun.inputSchema.required).toEqual(["runId"]);
      expect((getRun.inputSchema.properties as Record<string, any>).offset.type).toBe("integer");
    } finally {
      await close();
    }
  });

  test("get_run_results always exists and no token only breaks calls", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "google_search",
        arguments: { queries: ["x"] },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(TOKEN_MISSING_MESSAGE);

      const getRun = await client.callTool({
        name: "get_run_results",
        arguments: { runId: "run_1" },
      });
      expect(getRun.isError).toBe(true);
      expect(textOf(getRun)).toBe(TOKEN_MISSING_MESSAGE);
    } finally {
      await close();
    }
  });
});

describe("actor input mapping", () => {
  test("strips _maxItems/_maxChargeUsd from the Actor input and passes the run options", async () => {
    const fetchMock = installFetchMock(happyPathHandler({ itemCount: 1, items: [{ ok: true }] }));
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "google_search",
        arguments: {
          queries: ["best crm"],
          gl: "my",
          _maxItems: 1,
          _maxChargeUsd: 0.25,
        },
      });
      expect(result.isError).toBeFalsy();

      const post = fetchMock.of("POST")[0]!;
      expect(post.body).toEqual({ queries: ["best crm"], gl: "my" });
      expect(post.body).not.toHaveProperty("_maxItems");
      expect(post.body).not.toHaveProperty("_maxChargeUsd");

      const url = new URL(post.url);
      expect(url.pathname).toBe("/v2/acts/subimpact~google-serp-ai-overviews/runs");
      expect(url.searchParams.get("maxTotalChargeUsd")).toBe("0.25");
      expect(url.searchParams.get("waitForFinish")).toBe("5");

      expect(post.headers.authorization).toBe(`Bearer ${TEST_TOKEN}`);
      expect(post.headers["user-agent"]).toMatch(/^subimpact-data-mcp\/\d+\.\d+\.\d+/);
      expect(post.headers["content-type"]).toBe("application/json");
    } finally {
      await close();
    }
  });

  test("defaults maxTotalChargeUsd to 0.5 and maxItems to 50", async () => {
    const fetchMock = installFetchMock(happyPathHandler({ itemCount: 1, items: [{ ok: true }] }));
    const { client, close } = await connectTestClient();
    try {
      await client.callTool({
        name: "news_mentions",
        arguments: { keywords: ["petronas"] },
      });
      const post = fetchMock.of("POST")[0]!;
      const url = new URL(post.url);
      expect(url.pathname).toBe("/v2/acts/subimpact~news-mentions-api/runs");
      expect(url.searchParams.get("maxTotalChargeUsd")).toBe("0.5");
      expect(fetchMock.find("/items").url).toContain("limit=50");
    } finally {
      await close();
    }
  });

  test("accepts numeric strings for control params and rejects invalid values", async () => {
    const fetchMock = installFetchMock(happyPathHandler({ itemCount: 1, items: [{ ok: true }] }));
    const { client, close } = await connectTestClient();
    try {
      await client.callTool({
        name: "google_search",
        arguments: { queries: ["x"], _maxItems: "5", _maxChargeUsd: "1.5" },
      });
      const url = new URL(fetchMock.of("POST")[0]!.url);
      expect(url.searchParams.get("maxTotalChargeUsd")).toBe("1.5");
      expect(fetchMock.find("/items").url).toContain("limit=5");

      const badItems = await client.callTool({
        name: "google_search",
        arguments: { queries: ["x"], _maxItems: 0 },
      });
      expect(badItems.isError).toBe(true);
      expect(textOf(badItems)).toContain("_maxItems must be between 1 and 1000");

      const notInteger = await client.callTool({
        name: "google_search",
        arguments: { queries: ["x"], _maxItems: 2.5 },
      });
      expect(notInteger.isError).toBe(true);
      expect(textOf(notInteger)).toContain("_maxItems must be an integer");

      const badCharge = await client.callTool({
        name: "google_search",
        arguments: { queries: ["x"], _maxChargeUsd: 0 },
      });
      expect(badCharge.isError).toBe(true);
      expect(textOf(badCharge)).toContain("_maxChargeUsd must be between");
    } finally {
      await close();
    }
  });
});

describe("metadata helpers", () => {
  test("formatPrice normalizes exponent prices", () => {
    expect(formatPrice("Actor start: $5e-05")).toBe("Actor start: $0.00005");
    expect(formatPrice("Article: $0.001")).toBe("Article: $0.001");
    expect(formatPrice("Alert created: $0.01")).toBe("Alert created: $0.01");
    expect(formatPrice("Product scraped: $0.00099")).toBe("Product scraped: $0.00099");
  });

  test("pricingLine adds the platform usage clause only when the user pays it", () => {
    const specs = loadActorSpecs();
    const search = specs.find((spec) => spec.tool === "google_search")!;
    const modeSpec = specs.find((spec) => spec.tool === "google_ai_mode")!;
    expect(pricingLine(search)).not.toContain("platform usage");
    expect(pricingLine(modeSpec)).toContain("platform usage billed to your account");
  });
});

describe("unknown tools", () => {
  test("returns an isError result", async () => {
    const { client, close } = await connectTestClient();
    try {
      const result = await client.callTool({ name: "nope", arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Unknown tool "nope"');
    } finally {
      await close();
    }
  });
});
