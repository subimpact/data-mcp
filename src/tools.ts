/**
 * Actor metadata: reads the public Apify Store metadata snapshot in tools.json
 * and turns it into MCP tool definitions.
 */
import { readFileSync } from "node:fs";

/** A single Apify input-schema field, kept as loosely-typed JSON. */
export type JsonSchema = Record<string, unknown>;

export interface ActorInputSpec {
  properties: Record<string, JsonSchema>;
  required?: string[];
  [key: string]: unknown;
}

export interface ActorSpec {
  tool: string;
  actor: string;
  title: string;
  description: string | null;
  pricing: string[];
  usage_paid_by_user: boolean | null;
  input: ActorInputSpec;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Present for the 23 actor-backed tools, absent for get_run_results. */
  spec?: ActorSpec;
}

/** Keys of the Apify input schema that are meaningful in JSON Schema. */
const SCHEMA_KEYS = new Set([
  "type",
  "title",
  "description",
  "enum",
  "default",
  "items",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "properties",
  "required",
]);

/**
 * Strip Apify editor-only keys (prefill, example, enumTitles, section captions,
 * hidden, nullable, ...) and keep plain JSON Schema keywords.
 */
export function cleanSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const properties: Record<string, JsonSchema> = {};
      for (const [name, prop] of Object.entries(value as Record<string, JsonSchema>)) {
        properties[name] = cleanSchema(prop ?? {});
      }
      out.properties = properties;
    } else if (key === "items" && value && typeof value === "object" && !Array.isArray(value)) {
      out.items = cleanSchema(value as JsonSchema);
    } else {
      out[key] = value;
    }
  }
  // Apify sometimes omits `type` for object fields with nested properties.
  if (out.type === undefined) {
    if (out.properties !== undefined) out.type = "object";
    else if (out.items !== undefined) out.type = "array";
  }
  return out;
}

export const CONTROL_PARAMETERS: Record<string, JsonSchema> = {
  _maxItems: {
    type: "integer",
    title: "Max items returned",
    description:
      "How many dataset items to return to the model (1-1000, default 50). Truncates the response only; it does not change what the Actor collects or charges for.",
    minimum: 1,
    maximum: 1000,
    default: 50,
  },
  _maxChargeUsd: {
    type: "number",
    title: "Max charge (USD)",
    description:
      "Per-run spending cap in USD (default 0.5). Passed to Apify as the run option maxTotalChargeUsd, so the run stops when it reaches this charge.",
    minimum: 0.01,
    default: 0.5,
  },
};

/** Build the JSON Schema for one actor tool, including the two control params. */
export function buildInputSchema(spec: ActorSpec): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [name, prop] of Object.entries(spec.input.properties ?? {})) {
    properties[name] = cleanSchema(prop ?? {});
  }
  const required = (spec.input.required ?? []).filter((name) => name in properties);
  return {
    type: "object",
    properties: { ...properties, ...CONTROL_PARAMETERS },
    required,
    additionalProperties: true,
  };
}

/** Format a single price entry, e.g. "$5e-05" -> "$0.00005". */
export function formatPrice(entry: string): string {
  return entry.replace(/\$([0-9.]+(?:e[+-]?\d+)?)/gi, (_match, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return `$${raw}`;
    const fixed = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    return `$${fixed === "" ? "0" : fixed}`;
  });
}

/** Build the human-readable pricing line for a tool description. */
export function pricingLine(spec: ActorSpec): string {
  const prices = (spec.pricing ?? []).map(formatPrice).join("; ");
  const usage = spec.usage_paid_by_user
    ? "; platform usage billed to your account"
    : "";
  return `Pricing (pay per event, billed to your Apify account): ${prices}${usage}.`;
}

export function toolDescription(spec: ActorSpec): string {
  const summary = spec.description?.trim() || spec.title;
  return [
    spec.title,
    summary === spec.title ? undefined : summary,
    pricingLine(spec),
    `Runs on Apify as ${spec.actor}.`,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n\n");
}

export function buildToolDefinitions(specs: ActorSpec[]): ToolDefinition[] {
  return specs.map((spec) => ({
    name: spec.tool,
    description: toolDescription(spec),
    inputSchema: buildInputSchema(spec),
    spec,
  }));
}

let cachedSpecs: ActorSpec[] | null = null;

/** Load the verbatim tools.json snapshot bundled next to this module. */
export function loadActorSpecs(): ActorSpec[] {
  if (cachedSpecs) return cachedSpecs;
  const url = new URL("./tools.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(url, "utf8")) as ActorSpec[];
  if (!Array.isArray(parsed)) throw new Error("tools.json must contain an array");
  cachedSpecs = parsed;
  return parsed;
}
