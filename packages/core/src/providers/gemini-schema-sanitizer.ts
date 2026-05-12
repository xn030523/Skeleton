/**
 * Gemini tool schema sanitizer.
 *
 * Port of Hermes `agent/gemini_schema.py`.
 *
 * Gemini's FunctionDeclaration.parameters only accepts a subset of JSON Schema.
 * Strip unsupported keys before sending tool schemas to Google's API.
 * Without this, Gemini returns 400 "Invalid JSON payload" for tools that use
 * `additionalProperties`, `$schema`, `$defs`, `if/then/else`, etc.
 */

const GEMINI_SCHEMA_ALLOWED_KEYS = new Set([
  "type", "format", "title", "description", "nullable",
  "enum", "maxItems", "minItems", "properties", "required",
  "minProperties", "maxProperties", "minLength", "maxLength",
  "pattern", "example", "anyOf", "propertyOrdering", "default",
  "items", "minimum", "maximum",
]);

export function sanitizeGeminiSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return {};

  const input = schema as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!GEMINI_SCHEMA_ALLOWED_KEYS.has(key)) continue;

    if (key === "properties") {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        props[propName] = sanitizeGeminiSchema(propSchema);
      }
      cleaned[key] = props;
      continue;
    }

    if (key === "items") {
      cleaned[key] = sanitizeGeminiSchema(value);
      continue;
    }

    if (key === "anyOf") {
      if (!Array.isArray(value)) continue;
      cleaned[key] = value.filter(v => v && typeof v === "object").map(v => sanitizeGeminiSchema(v));
      continue;
    }

    cleaned[key] = value;
  }

  // Gemini requires every enum entry to be a string.
  // For integer/number/boolean enums, drop the enum (keep type + description).
  const enumVal = cleaned.enum;
  const typeVal = cleaned.type;
  if (Array.isArray(enumVal) && (typeVal === "integer" || typeVal === "number" || typeVal === "boolean")) {
    if (enumVal.some(item => typeof item !== "string")) {
      delete cleaned.enum;
    }
  }

  return cleaned;
}

/** Normalize tool parameters to a valid Gemini object schema. */
export function sanitizeGeminiToolParameters(parameters: unknown): Record<string, unknown> {
  const cleaned = sanitizeGeminiSchema(parameters);
  if (!cleaned || Object.keys(cleaned).length === 0) {
    return { type: "object", properties: {} };
  }
  return cleaned;
}
