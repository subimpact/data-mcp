/**
 * MCP server: exposes one tool per subimpact Apify actor plus get_run_results.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ApifyClient,
  ApifyHttpError,
  DEFAULT_MAX_CHARGE_USD,
  DEFAULT_MAX_ITEMS,
  FAILED_STATUSES,
  consoleUrlFor,
  getRunBudgetMs,
  isTerminalStatus,
  startAndWaitForRun,
} from "./apify.js";
import {
  buildToolDefinitions,
  loadActorSpecs,
  type ActorSpec,
  type JsonSchema,
  type ToolDefinition,
} from "./tools.js";
import { VERSION } from "./version.js";

export const SERVER_NAME = "subimpact-data";

export const TOKEN_MISSING_MESSAGE =
  "Set APIFY_TOKEN to your Apify API token (https://console.apify.com/settings/integrations). Runs are billed to your Apify account.";

export const INSTRUCTIONS = `Subimpact Data MCP exposes 19 data tools, one per subimpact actor on the Apify Store: Google SERP + AI Overviews, Google AI Mode, news mentions, Google Maps places, Google Jobs, website contacts, Google Trends, page-to-markdown, Google Ads Transparency, YouTube, TikTok hashtags, Eventbrite, ATS/career jobs, Substack, Bluesky, Lazada products, JSON-LD entities, SEO page audits and Pinterest.

How it works: each tool call starts one Actor run on Apify with YOUR own APIFY_TOKEN and returns that run's dataset items as JSON. Nothing is scraped locally and the server holds no credentials of its own.

Costs: every call is a real Apify run billed to your Apify account at the Actor's pay-per-event Store price (listed in each tool description). _maxChargeUsd (default ${DEFAULT_MAX_CHARGE_USD} USD) is passed to Apify as maxTotalChargeUsd and caps the total charge of a single run; the run stops when the cap is reached. _maxItems (default ${DEFAULT_MAX_ITEMS}, max 1000) only limits how many dataset items are returned to you — it does not change what the Actor collects or charges.

Long jobs: a call waits up to SUBIMPACT_TIMEOUT_SECS (default 240) for the run to finish. If the run is still going, the response contains a runId; call get_run_results with that runId (plus optional _maxItems and offset) to fetch the status and items later.

Setup: set APIFY_TOKEN to an Apify API token from https://console.apify.com/settings/integrations. Optional: SUBIMPACT_TOOLS or --tools a,b,c limits the exposed tools; SUBIMPACT_TIMEOUT_SECS changes the wait budget.`;

export const GET_RUN_RESULTS_TOOL: ToolDefinition = {
  name: "get_run_results",
  description:
    "Fetch the status and dataset items of an Actor run started by one of the data tools, for example a run that was still running when its tool call returned.\n\nReturns the run status, the total dataset item count and the items themselves (offset by `offset`, capped by _maxItems). Running runs are long-polled for up to 60 seconds; if still running, call again with the same runId.\n\nApify run results are billed to your Apify account like any other run.",
  inputSchema: {
    type: "object",
    properties: {
      runId: {
        type: "string",
        title: "Run ID",
        description: "The Apify run ID returned by a data tool call.",
      },
      _maxItems: {
        type: "integer",
        title: "Max items returned",
        description: "How many dataset items to return (1-1000, default 50).",
        minimum: 1,
        maximum: 1000,
        default: 50,
      },
      _maxChargeUsd: {
        type: "number",
        title: "Max charge (USD)",
        description:
          "Present for interface uniformity with the data tools (default 0.5). Retrieving results does not start a new run, so this has no effect on cost.",
        minimum: 0.01,
        default: 0.5,
      },
      offset: {
        type: "integer",
        title: "Offset",
        description: "Number of dataset items to skip (default 0).",
        minimum: 0,
        default: 0,
      },
    },
    required: ["runId"],
    additionalProperties: true,
  },
};

export type CallToolResultShape = CallToolResult;

export class ToolInputError extends Error {}

function jsonResult(payload: unknown): CallToolResultShape {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(message: string): CallToolResultShape {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Parse a comma/whitespace separated tool list (env var or --tools flag). */
export function parseToolFilter(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const names = raw
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.length > 0 ? Array.from(new Set(names)) : undefined;
}

/**
 * Restrict the actor tools to the requested names. get_run_results is always
 * available because a filtered tool can still return a runId.
 */
export function selectActorSpecs(
  specs: ActorSpec[],
  filter?: string[],
): ActorSpec[] {
  if (!filter || filter.length === 0) return specs;
  const wanted = new Set(filter);
  return specs.filter((spec) => wanted.has(spec.tool));
}

function readNumber(
  value: unknown,
  name: string,
  options: { min: number; max: number },
): number {
  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    numeric = Number(value);
  } else {
    throw new ToolInputError(`${name} must be a number.`);
  }
  if (!Number.isFinite(numeric)) {
    throw new ToolInputError(`${name} must be a finite number.`);
  }
  if (numeric < options.min || numeric > options.max) {
    throw new ToolInputError(
      `${name} must be between ${options.min} and ${options.max}.`,
    );
  }
  return numeric;
}

function readInteger(
  value: unknown,
  name: string,
  options: { min: number; max: number },
): number {
  const numeric = readNumber(value, name, options);
  if (!Number.isInteger(numeric)) {
    throw new ToolInputError(`${name} must be an integer.`);
  }
  return numeric;
}

interface ControlOptions {
  maxItems: number;
  maxChargeUsd: number;
  input: Record<string, unknown>;
}

/** Split control params (_maxItems, _maxChargeUsd) from the Actor input. */
function splitControlArgs(args: Record<string, unknown>): ControlOptions {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "_maxItems" || key === "_maxChargeUsd") continue;
    input[key] = value;
  }
  const maxItems =
    args._maxItems === undefined
      ? DEFAULT_MAX_ITEMS
      : readInteger(args._maxItems, "_maxItems", { min: 1, max: 1000 });
  const maxChargeUsd =
    args._maxChargeUsd === undefined
      ? DEFAULT_MAX_CHARGE_USD
      : readNumber(args._maxChargeUsd, "_maxChargeUsd", {
          min: 0.01,
          max: 10_000,
        });
  return { maxItems, maxChargeUsd, input };
}

function requireToken(): string | undefined {
  const token = process.env.APIFY_TOKEN?.trim();
  return token && token.length > 0 ? token : undefined;
}

interface CollectOptions {
  maxItems: number;
  offset: number;
  actorLabel?: string;
}

async function collectRunResults(
  client: ApifyClient,
  run: { id: string; status: string; statusMessage?: string | null; defaultDatasetId?: string },
  options: CollectOptions,
): Promise<CallToolResultShape> {
  const datasetId = run.defaultDatasetId;
  if (!datasetId) {
    return errorResult(
      `Run ${run.id} finished with status ${run.status} but has no default dataset, so there are no items to return.`,
    );
  }

  const [dataset, items] = await Promise.all([
    client.getDataset(datasetId),
    client.getDatasetItems(datasetId, {
      limit: options.maxItems,
      offset: options.offset,
    }),
  ]);

  const returned = items.length;
  // Dataset metadata (itemCount) can lag a few seconds behind a just-finished run,
  // so never report fewer items than were actually returned.
  const reported = Math.max(dataset.itemCount ?? 0, dataset.cleanItemCount ?? 0);
  const total = Math.max(reported, options.offset + returned);
  const mayHaveMore = reported < options.offset + returned && returned >= options.maxItems;
  const payload: Record<string, unknown> = {};
  if (options.actorLabel) payload.actor = options.actorLabel;
  payload.runId = run.id;
  payload.status = run.status;
  payload.statusMessage = run.statusMessage ?? null;
  payload.itemCount = total;
  payload.returned = returned;
  if (options.offset > 0) payload.offset = options.offset;
  payload.items = items;
  payload.consoleUrl = consoleUrlFor(run.id);

  if (total > options.offset + returned) {
    const shownFrom = options.offset + 1;
    const shownTo = options.offset + returned;
    payload.note = `Showing dataset items ${shownFrom}-${shownTo} of ${total}. Increase _maxItems (max 1000) or page with offset to fetch more.`;
  } else if (mayHaveMore) {
    payload.note = `Returned ${returned} item(s), the _maxItems limit; the run may have more. Call get_run_results with this runId and offset ${options.offset + returned} to fetch the rest.`;
  }
  return jsonResult(payload);
}

async function executeActorTool(
  spec: ActorSpec,
  args: Record<string, unknown>,
  token: string,
): Promise<CallToolResultShape> {
  const { maxItems, maxChargeUsd, input } = splitControlArgs(args);
  const client = new ApifyClient(token);
  const budgetMs = getRunBudgetMs();

  const { run, timedOut } = await startAndWaitForRun(client, spec.actor, input, {
    maxTotalChargeUsd: maxChargeUsd,
    budgetMs,
  });

  if (timedOut || !isTerminalStatus(run.status)) {
    return jsonResult({
      actor: spec.actor,
      runId: run.id,
      status: run.status,
      statusMessage: run.statusMessage ?? null,
      consoleUrl: consoleUrlFor(run.id),
      note: "still running; call get_run_results with this runId",
    });
  }

  if (FAILED_STATUSES.has(run.status)) {
    return errorResult(
      `Actor run ${run.id} ended with status ${run.status}: ${
        run.statusMessage?.trim() || "Apify reported no status message"
      }. See ${consoleUrlFor(run.id)}`,
    );
  }

  return collectRunResults(client, run, {
    maxItems,
    offset: 0,
    actorLabel: spec.actor,
  });
}

async function executeGetRunResults(
  args: Record<string, unknown>,
  token: string,
): Promise<CallToolResultShape> {
  const runId = typeof args.runId === "string" ? args.runId.trim() : "";
  if (!runId) throw new ToolInputError("runId is required.");
  const maxItems =
    args._maxItems === undefined
      ? DEFAULT_MAX_ITEMS
      : readInteger(args._maxItems, "_maxItems", { min: 1, max: 1000 });
  const offset =
    args.offset === undefined
      ? 0
      : readInteger(args.offset, "offset", { min: 0, max: 100_000 });
  if (args._maxChargeUsd !== undefined) {
    // Accepted for interface uniformity; results retrieval starts no new run.
    readNumber(args._maxChargeUsd, "_maxChargeUsd", { min: 0.01, max: 10_000 });
  }

  const client = new ApifyClient(token);
  const run = await client.getRun(runId, 60);

  if (FAILED_STATUSES.has(run.status)) {
    return errorResult(
      `Actor run ${run.id} ended with status ${run.status}: ${
        run.statusMessage?.trim() || "Apify reported no status message"
      }. See ${consoleUrlFor(run.id)}`,
    );
  }
  if (!isTerminalStatus(run.status)) {
    return jsonResult({
      runId: run.id,
      status: run.status,
      statusMessage: run.statusMessage ?? null,
      consoleUrl: consoleUrlFor(run.id),
      note: "still running; call get_run_results with this runId",
    });
  }

  return collectRunResults(client, run, {
    maxItems,
    offset,
    actorLabel: run.actId,
  });
}

function toApifyErrorResult(error: unknown): CallToolResultShape {
  if (error instanceof ToolInputError) return errorResult(error.message);
  if (error instanceof ApifyHttpError) {
    return errorResult(error.message);
  }
  if (error instanceof Error) {
    return errorResult(`Unexpected error: ${error.message}`);
  }
  return errorResult(`Unexpected error: ${String(error)}`);
}

export interface CreateServerOptions {
  /** Optional subset of actor tool names to expose. */
  toolFilter?: string[];
  /** Override the actor spec list (used by tests). */
  specs?: ActorSpec[];
}

/** Build the MCP server with all (or a filtered subset of) tools. */
export function createServer(options: CreateServerOptions = {}): Server {
  const allSpecs = options.specs ?? loadActorSpecs();
  const specs = selectActorSpecs(allSpecs, options.toolFilter);
  if (options.toolFilter && options.toolFilter.length > 0 && specs.length === 0) {
    const known = allSpecs.map((spec) => spec.tool).join(", ");
    throw new Error(
      `No known tools matched. Available tools: ${known}, get_run_results`,
    );
  }

  const actorTools = buildToolDefinitions(specs);
  const tools: ToolDefinition[] = [...actorTools, GET_RUN_RESULTS_TOOL];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const server = new Server(
    { name: SERVER_NAME, version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as JsonSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const tool = byName.get(name);
    if (!tool) {
      return errorResult(
        `Unknown tool "${name}". Call tools/list to see the available tools.`,
      );
    }

    const token = requireToken();
    if (!token) return errorResult(TOKEN_MISSING_MESSAGE);

    try {
      if (name === GET_RUN_RESULTS_TOOL.name) {
        return await executeGetRunResults(args, token);
      }
      if (!tool.spec) {
        return errorResult(`Tool "${name}" is not backed by an Actor.`);
      }
      return await executeActorTool(tool.spec, args, token);
    } catch (error) {
      return toApifyErrorResult(error);
    }
  });

  return server;
}

export { loadActorSpecs, buildToolDefinitions, formatPrice } from "./tools.js";
