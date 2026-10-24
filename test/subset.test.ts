import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createServer, parseToolFilter, selectActorSpecs } from "../src/server.js";
import { loadActorSpecs } from "../src/tools.js";
import { TEST_API_BASE, TEST_TOKEN, connectTestClient } from "./helpers.js";

beforeEach(() => {
  vi.stubEnv("APIFY_TOKEN", TEST_TOKEN);
  vi.stubEnv("SUBIMPACT_API_BASE", TEST_API_BASE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tool subsets", () => {
  test("parseToolFilter handles commas, whitespace, dedupe and emptiness", () => {
    expect(parseToolFilter("google_search, news_mentions")).toEqual([
      "google_search",
      "news_mentions",
    ]);
    expect(parseToolFilter(" google_search  news_mentions ")).toEqual([
      "google_search",
      "news_mentions",
    ]);
    expect(parseToolFilter("a,a,b")).toEqual(["a", "b"]);
    expect(parseToolFilter("")).toBeUndefined();
    expect(parseToolFilter(undefined)).toBeUndefined();
  });

  test("toolFilter limits actor tools but keeps get_run_results", async () => {
    const { client, close } = await connectTestClient({
      toolFilter: ["google_search", "news_mentions"],
    });
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "get_run_results",
        "google_search",
        "news_mentions",
      ]);
    } finally {
      await close();
    }
  });

  test("selectActorSpecs preserves the tools.json order", () => {
    const specs = loadActorSpecs();
    const selected = selectActorSpecs(specs, ["pinterest", "google_search"]);
    expect(selected.map((spec) => spec.tool)).toEqual(["google_search", "pinterest"]);
    expect(selectActorSpecs(specs, undefined)).toHaveLength(19);
  });

  test("an unknown-only filter fails with the list of valid names", () => {
    expect(() => createServer({ toolFilter: ["does_not_exist"] })).toThrow(
      /No known tools matched.*google_search/s,
    );
  });
});
