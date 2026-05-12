/**
 * Moonshot (Kimi) tool schema sanitizer.
 *
 * Port of Hermes `agent/moonshot_schema.py`.
 *
 * Moonshot accepts a stricter subset of JSON Schema than standard OpenAI.
 * Requests that violate it fail with HTTP 400:
 *   "tools.function.parameters is not a valid moonshot flavored json schema"
 *
 * Known rejection modes:
 *   1. Every property schema must carry a `type` (Moonshot refuses unconstrained)
 *   2. When `anyOf` is used, `type` must be on the children, not the parent
 *   3. `null` / empty-string enum values rejected for scalar types
 *   4. `nullable` keyword not supported — strip it
 */

const SCHEMA_MAP_KEYS = new Set(["properties", "patternProperties", "$defs", "definitions"]);
const SCHEMA_LIST_KEYS = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);
const SCHEMA_NODE_KEYS = new Set(["items", "contains", "not", "additionalProperties", "propertyNames"]);

function repairSchema(node: unknown, isSchema = true): unknown {
  if (Array.isArray(node)) {
    return node.map(item => repairSchema(item, true));
  }
  if (!node || typeof node !== "object") return node;

  const input = node as Record<string, unknown>;
  const repaired: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (SCHEMA_MAP_KEYS.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
      const map: Record<string, unknown> = {};
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        map[subKey] = repairSchema(subVal, true);
      }
      repaired[key] = map;
    } else if (SCHEMA_LIST_KEYS.has(key) && Array.isArray(value)) {
      repaired[key] = value.map(v => repairSchema(v, true));
    } else if (SCHEMA_NODE_KEYS.has(key)) {
      repaired[key] = typeof value === "object" && value !== null && !Array.isArray(value)
        ? repairSchema(value, true)
        : value;
    } else {
      repaired[key] = value;
    }
  }

  if (!isSchema) return repaired;

  // Rule 2: anyOf present → strip type from parent, collapse null branches.
  if ("anyOf" in repaired && Array.isArray(repaired.anyOf)) {
    delete repaired.type;
    const nonNull = (repaired.anyOf as unknown[]).filter(
      b => b && typeof b === "object" && (b as Record<string, unknown>).type !== "null",
    );
    if (nonNull.length > 0 && nonNull.length < (repaired.anyOf as unknown[]).length) {
      if (nonNull.length === 1) {
        const merged = { ...repaired };
        delete merged.anyOf;
        Object.assign(merged, nonNull[0] as object);
        return repairSchema(merged, true);
      }
      repaired.anyOf = nonNull;
      return repaired;
    }
    return repaired;
  }

  // Strip nullable (not supported by Moonshot).
  delete repaired.nullable;

  // Rule 1: fill missing type.
  if (!("$ref" in repaired)) {
    fillMissingType(repaired);
  }

  // Rule 3: strip null / empty-string from enum for scalar types.
  if ("enum" in repaired && Array.isArray(repaired.enum)) {
    const t = repaired.type;
    if (t === "string" || t === "integer" || t === "number" || t === "boolean") {
      const cleaned = (repaired.enum as unknown[]).filter(v => v !== null && v !== "");
      if (cleaned.length > 0) repaired.enum = cleaned;
      else delete repaired.enum;
    }
  }

  return repaired;
}

function fillMissingType(node: Record<string, unknown>): void {
  if (node.type && node.type !== null && node.type !== "") return;
  let inferred: string;
  if ("properties" in node || "required" in node || "additionalProperties" in node) {
    inferred = "object";
  } else if ("items" in node || "prefixItems" in node) {
    inferred = "array";
  } else if ("enum" in node && Array.isArray(node.enum) && node.enum.length > 0) {
    const sample = node.enum[0];
    if (typeof sample === "boolean") inferred = "boolean";
    else if (Number.isInteger(sample)) inferred = "integer";
    else if (typeof sample === "number") inferred = "number";
    else inferred = "string";
  } else {
    inferred = "string";
  }
  node.type = inferred;
}

export function sanitizeMoonshotToolParameters(parameters: unknown): Record<string, unknown> {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return { type: "object", properties: {} };
  }
  const repaired = repairSchema(JSON.parse(JSON.stringify(parameters)), true) as Record<string, unknown>;
  if (repaired.type !== "object") repaired.type = "object";
  if (!("properties" in repaired)) repaired.properties = {};
  return repaired;
}

export function isMoonshotModel(model: string | undefined | null): boolean {
  if (!model) return false;
  const bare = model.trim().toLowerCase();
  const tail = bare.includes("/") ? bare.split("/").pop()! : bare;
  if (tail.startsWith("kimi-") || tail === "kimi") return true;
  if (bare.includes("moonshot") || bare.includes("/kimi") || bare.startsWith("kimi")) return true;
  return false;
}
