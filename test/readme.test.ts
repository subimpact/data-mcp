import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { loadActorSpecs } from "../src/tools.js";
import { applyToolsSection, renderToolsSection } from "../scripts/gen-readme.mjs";

describe("generated README", () => {
  test("tool table is up to date with tools.json", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/gen-readme.mjs", "--check"],
      { encoding: "utf8" },
    );
    expect(output).toContain("up to date");
  });

  test("renders one row per actor with its Store link and price", () => {
    const specs = loadActorSpecs();
    const table = renderToolsSection(specs);
    const rows = table.split("\n").filter((line) => line.startsWith("| [`"));
    expect(rows).toHaveLength(specs.length);
    expect(table).toContain("https://apify.com/subimpact/google-serp-ai-overviews");
    expect(table).toContain("Google SERP: $0.003");
    expect(table).toContain("platform usage");

    const readme = readFileSync("README.md", "utf8");
    expect(applyToolsSection(readme, specs)).toBe(readme);
  });
});
