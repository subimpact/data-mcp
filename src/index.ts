#!/usr/bin/env node
/** CLI entry point: stdio MCP server for subimpact's Apify data actors. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createServer,
  parseToolFilter,
  TOKEN_MISSING_MESSAGE,
} from "./server.js";
import { VERSION } from "./version.js";

const HELP = `subimpact-data-mcp ${VERSION}

stdio MCP server exposing subimpact's Apify Store actors (Google SERP + AI
Overviews, AI Mode, news, Maps, jobs, trends, social and commerce data) as tools.

Usage:
  subimpact-data-mcp [--tools a,b,c] [--help] [--version]

Environment:
  APIFY_TOKEN              Apify API token; every tool call runs an Actor on
                           your own Apify account and is billed there.
  SUBIMPACT_TOOLS          Optional comma-separated subset of tool names.
  SUBIMPACT_TIMEOUT_SECS   Per-call wait budget in seconds (default 240).
  SUBIMPACT_API_BASE       Override the Apify API base URL (for testing).

Examples:
  claude mcp add subimpact-data -e APIFY_TOKEN=... -- npx -y @subimpact/data-mcp
  subimpact-data-mcp --tools google_search,news_mentions`;

interface CliOptions {
  toolFilter?: string[];
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { help: false, version: false };
  const filters: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--version" || arg === "-v") {
      options.version = true;
    } else if (arg === "--tools") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--tools requires a value, e.g. --tools google_search,news_mentions");
      filters.push(value);
      index += 1;
    } else if (arg.startsWith("--tools=")) {
      filters.push(arg.slice("--tools=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const explicit = parseToolFilter(filters.join(","));
  const fromEnv = parseToolFilter(process.env.SUBIMPACT_TOOLS);
  options.toolFilter = explicit ?? fromEnv;
  return options;
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (!process.env.APIFY_TOKEN?.trim()) {
    // Never exit: tools/list must work without credentials for directories
    // that introspect the server. Calls explain how to set the token.
    process.stderr.write(`[subimpact-data-mcp] ${TOKEN_MISSING_MESSAGE}\n`);
  }

  const server = createServer({ toolFilter: options.toolFilter });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[subimpact-data-mcp] fatal: ${message}\n`);
  process.exitCode = 1;
});
