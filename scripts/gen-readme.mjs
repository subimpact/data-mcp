#!/usr/bin/env node
/**
 * Generate the tool table in README.md from src/tools.json.
 *
 * Usage:
 *   node scripts/gen-readme.mjs          # rewrite the marked section
 *   node scripts/gen-readme.mjs --check  # exit 1 if README is out of date
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_PATH = join(ROOT, "src", "tools.json");
const README_PATH = join(ROOT, "README.md");
const START = "<!-- tools:start -->";
const END = "<!-- tools:end -->";

/** Same price formatting as the server: $5e-05 -> $0.00005. */
export function formatPrice(entry) {
  return entry.replace(/\$([0-9.]+(?:e[+-]?\d+)?)/gi, (_match, raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return `$${raw}`;
    const fixed = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    return `$${fixed === "" ? "0" : fixed}`;
  });
}

function priceCell(spec) {
  const prices = (spec.pricing ?? []).map(formatPrice).join("; ");
  const usage = spec.usage_paid_by_user ? " + platform usage" : "";
  return `${prices}${usage}`;
}

function summarize(description, maxLength = 170) {
  const flat = String(description ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= maxLength) return flat;
  const cut = flat.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 100 ? lastSpace : maxLength).trimEnd()}…`;
}

function escapeCell(text) {
  return text.replace(/\|/g, "\\|");
}

/** Render the generated section from tools.json. */
export function renderToolsSection(specs) {
  const rows = specs.map((spec) => {
    const link = `https://apify.com/${spec.actor}`;
    const name = `[\`${spec.tool}\`](${link})`;
    const summary = summarize(spec.description) || summarize(spec.title);
    return `| ${name} | ${escapeCell(summary)} | ${escapeCell(priceCell(spec))} |`;
  });
  return [
    "| Tool | What it does | Price |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** Replace the marked section in a README string. */
export function applyToolsSection(readme, specs) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md must contain ${START} and ${END}`);
  }
  return (
    readme.slice(0, start + START.length) +
    "\n\n" +
    renderToolsSection(specs) +
    "\n\n" +
    readme.slice(end)
  );
}

function main() {
  const specs = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error("src/tools.json must be a non-empty array");
  }
  const readme = readFileSync(README_PATH, "utf8");
  const updated = applyToolsSection(readme, specs);
  const check = process.argv.includes("--check");

  if (check) {
    if (updated !== readme) {
      console.error("README.md tool table is out of date. Run: npm run gen:readme");
      process.exit(1);
    }
    console.log(`README.md tool table is up to date (${specs.length} tools).`);
    return;
  }

  if (updated === readme) {
    console.log("README.md tool table already up to date.");
    return;
  }
  writeFileSync(README_PATH, updated);
  console.log(`Updated README.md tool table (${specs.length} tools).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
