/**
 * Minimal Apify API v2 client (fetch based, no SDK) used by the MCP tools.
 *
 * Endpoints (https://docs.apify.com/api/v2):
 *  - POST /v2/acts/:actorId/runs?maxTotalChargeUsd=&waitForFinish=  (actors-runs-post)
 *  - GET  /v2/actor-runs/:runId?waitForFinish=                      (actor-run-get)
 *  - GET  /v2/datasets/:datasetId                                   (dataset-get)
 *  - GET  /v2/datasets/:datasetId/items?clean=&limit=&offset=       (dataset-items-get)
 */
import { USER_AGENT } from "./version.js";

export const DEFAULT_API_BASE = "https://api.apify.com/v2";
export const DEFAULT_TIMEOUT_SECS = 240;
export const DEFAULT_MAX_ITEMS = 50;
export const DEFAULT_MAX_CHARGE_USD = 0.5;

/** Statuses after which Apify will not change the run state again. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "SUCCEEDED",
  "FAILED",
  "ABORTED",
  "TIMED-OUT",
]);

export const FAILED_STATUSES: ReadonlySet<string> = new Set([
  "FAILED",
  "ABORTED",
  "TIMED-OUT",
]);

export function isTerminalStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && TERMINAL_STATUSES.has(status);
}

export interface RunObject {
  id: string;
  actId?: string;
  status: string;
  statusMessage?: string | null;
  defaultDatasetId?: string;
  usageTotalUsd?: number | null;
  [key: string]: unknown;
}

export interface DatasetObject {
  id: string;
  itemCount?: number;
  cleanItemCount?: number;
  [key: string]: unknown;
}

export class ApifyHttpError extends Error {
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;
  readonly apifyMessage?: string;

  constructor(
    message: string,
    statusCode: number,
    options: { retryAfterSeconds?: number; apifyMessage?: string } = {},
  ) {
    super(message);
    this.name = "ApifyHttpError";
    this.statusCode = statusCode;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.apifyMessage = options.apifyMessage;
  }
}

/** Base URL for the API; tests point this at a local mock server. */
export function getApiBase(): string {
  const raw = process.env.SUBIMPACT_API_BASE?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_API_BASE;
  return base.replace(/\/+$/, "");
}

/** Overall per-tool-call budget in milliseconds. */
export function getRunBudgetMs(): number {
  const raw = process.env.SUBIMPACT_TIMEOUT_SECS?.trim();
  const parsed = raw ? Number(raw) : NaN;
  const secs =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_SECS;
  return Math.round(secs * 1000);
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.round((date - Date.now()) / 1000));
  }
  return undefined;
}

function extractApifyMessage(bodyText: string): string | undefined {
  if (!bodyText) return undefined;
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: unknown; type?: unknown };
      message?: unknown;
    };
    const error = parsed.error;
    if (error && typeof error.message === "string") return error.message;
    if (typeof parsed.message === "string") return parsed.message;
    return undefined;
  } catch {
    const trimmed = bodyText.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 300) : undefined;
  }
}

/** Turn an Apify HTTP failure into a human-readable error. */
export function mapHttpError(
  status: number,
  retryAfterHeader: string | null,
  bodyText: string,
): ApifyHttpError {
  const detail = extractApifyMessage(bodyText);
  const suffix = detail ? ` Apify said: ${detail}` : "";
  const retryAfterSeconds = parseRetryAfter(retryAfterHeader);

  switch (status) {
    case 401:
      return new ApifyHttpError(
        "Apify rejected your API token (HTTP 401 Unauthorized). Set APIFY_TOKEN to a valid Apify API token from https://console.apify.com/settings/integrations." +
          suffix,
        401,
        { apifyMessage: detail },
      );
    case 402:
      return new ApifyHttpError(
        "Apify could not charge your account (HTTP 402 Payment Required): your Apify credit or monthly charge limit may be exhausted. Top up or raise the limit at https://console.apify.com/billing, or lower _maxChargeUsd." +
          suffix,
        402,
        { apifyMessage: detail },
      );
    case 403:
      return new ApifyHttpError(
        "Apify denied the request (HTTP 403 Forbidden). Your token may lack permission for this Actor, or your account reached a run limit." +
          suffix,
        403,
        { apifyMessage: detail },
      );
    case 429: {
      const wait =
        retryAfterSeconds !== undefined
          ? ` Retry in ${retryAfterSeconds}s.`
          : " Retry shortly.";
      return new ApifyHttpError(
        `Apify rate-limited the request (HTTP 429 Too Many Requests).${wait}${suffix}`,
        429,
        { retryAfterSeconds, apifyMessage: detail },
      );
    }
    default:
      return new ApifyHttpError(
        `Apify API request failed (HTTP ${status}).${suffix}`,
        status,
        { apifyMessage: detail },
      );
  }
}

export interface RunStartOptions {
  maxTotalChargeUsd: number;
  waitForFinishSecs: number;
}

export class ApifyClient {
  private readonly token: string;
  private readonly apiBase: string;

  constructor(token: string, apiBase: string = getApiBase()) {
    this.token = token;
    this.apiBase = apiBase.replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    };
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const url = `${this.apiBase}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ApifyHttpError(
        `Could not reach the Apify API at ${this.apiBase}: ${reason}`,
        0,
      );
    }

    const bodyText = await response.text();
    if (!response.ok) {
      throw mapHttpError(
        response.status,
        response.headers.get("retry-after"),
        bodyText,
      );
    }
    if (bodyText.length === 0) return undefined;
    try {
      return JSON.parse(bodyText) as unknown;
    } catch {
      throw new ApifyHttpError(
        `Apify returned a non-JSON response (HTTP ${response.status}).`,
        response.status,
      );
    }
  }

  /** POST /acts/:actorId/runs — actorId uses `owner~name`. */
  async startRun(
    actor: string,
    input: Record<string, unknown>,
    options: RunStartOptions,
  ): Promise<RunObject> {
    const actorId = actor.includes("/") ? actor.replace("/", "~") : actor;
    const params = new URLSearchParams({
      maxTotalChargeUsd: String(options.maxTotalChargeUsd),
      waitForFinish: String(options.waitForFinishSecs),
    });
    const body = await this.request(
      `/acts/${encodeURIComponent(actorId)}/runs?${params.toString()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input ?? {}),
      },
    );
    return unwrapData<RunObject>(body, "run");
  }

  /** GET /actor-runs/:runId — optionally long-polls. */
  async getRun(runId: string, waitForFinishSecs = 0): Promise<RunObject> {
    const params = new URLSearchParams({
      waitForFinish: String(waitForFinishSecs),
    });
    const body = await this.request(
      `/actor-runs/${encodeURIComponent(runId)}?${params.toString()}`,
    );
    return unwrapData<RunObject>(body, "run");
  }

  /** GET /datasets/:datasetId — metadata, including itemCount. */
  async getDataset(datasetId: string): Promise<DatasetObject> {
    const body = await this.request(`/datasets/${encodeURIComponent(datasetId)}`);
    return unwrapData<DatasetObject>(body, "dataset");
  }

  /** GET /datasets/:datasetId/items — clean JSON items. */
  async getDatasetItems(
    datasetId: string,
    options: { limit: number; offset?: number },
  ): Promise<unknown[]> {
    const params = new URLSearchParams({
      clean: "true",
      limit: String(options.limit),
      offset: String(options.offset ?? 0),
    });
    const body = await this.request(
      `/datasets/${encodeURIComponent(datasetId)}/items?${params.toString()}`,
    );
    if (Array.isArray(body)) return body;
    if (body && typeof body === "object" && Array.isArray((body as { items?: unknown[] }).items)) {
      return (body as { items: unknown[] }).items;
    }
    return [];
  }
}

function unwrapData<T>(body: unknown, what: string): T {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: T }).data;
  }
  if (body && typeof body === "object") return body as T;
  throw new ApifyHttpError(`Apify returned an unexpected ${what} response.`, 502);
}

export interface PollResult {
  run: RunObject;
  timedOut: boolean;
}

function nextWaitSeconds(deadline: number): number {
  const remainingMs = deadline - Date.now();
  return Math.max(1, Math.min(60, Math.ceil(remainingMs / 1000)));
}

/** Poll GET /actor-runs/:id until terminal or the budget deadline passes. */
export async function waitForRun(
  client: ApifyClient,
  run: RunObject,
  deadline: number,
): Promise<PollResult> {
  let current = run;
  while (!isTerminalStatus(current.status)) {
    if (Date.now() >= deadline) return { run: current, timedOut: true };
    current = await client.getRun(current.id, nextWaitSeconds(deadline));
  }
  return { run: current, timedOut: false };
}

/** Start an actor run and wait for it within the overall budget. */
export async function startAndWaitForRun(
  client: ApifyClient,
  actor: string,
  input: Record<string, unknown>,
  options: { maxTotalChargeUsd: number; budgetMs: number },
): Promise<PollResult> {
  const deadline = Date.now() + options.budgetMs;
  const run = await client.startRun(actor, input, {
    maxTotalChargeUsd: options.maxTotalChargeUsd,
    waitForFinishSecs: nextWaitSeconds(deadline),
  });
  return waitForRun(client, run, deadline);
}

export function consoleUrlFor(runId: string): string {
  return `https://console.apify.com/view/runs/${runId}`;
}
