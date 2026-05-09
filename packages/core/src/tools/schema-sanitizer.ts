/**
 * Schema Sanitizer — fixes JSON Schema constructs that break
 * LLM backend compatibility (llama.cpp, some providers).
 *
 * Fixes: object without properties, bare string type, anyOf/oneOf
 * null unions, unconstrained additionalProperties.
 *
 * Inspired by Hermes schema_sanitizer.py.
 */

/** Deep-sanitize a tool parameter schema for broad LLM compatibility */
export function sanitizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return sanitizeNode(schema, 0);
}

function sanitizeNode(node: unknown, depth: number): unknown {
  if (depth > 10) return node; // Prevent infinite recursion
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    if (Array.isArray(node)) return (node as unknown[]).map(v => sanitizeNode(v, depth + 1));
    return node;
  }

  const obj = { ...(node as Record<string, unknown>) };

  // Fix: object without properties → add empty properties
  if (obj.type === "object" && !obj.properties) {
    obj.properties = {};
  }

  // Fix: unconstrained additionalProperties → set to false
  if (obj.type === "object" && obj.additionalProperties === true) {
    obj.additionalProperties = false;
  }

  // Fix: anyOf/oneOf null unions → strip null, keep real type
  for (const key of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(obj[key])) {
      const variants = obj[key] as Array<Record<string, unknown>>;
      const nonNull = variants.filter(v => v.type !== "null" && v.type !== undefined);
      if (nonNull.length === 1 && variants.length === 2) {
        // Collapse: anyOf: [{type: string}, {type: null}] → {type: string}
        const collapsed = sanitizeNode(nonNull[0], depth + 1) as Record<string, unknown>;
        for (const [k, v] of Object.entries(collapsed)) {
          obj[k] = v;
        }
        delete obj[key];
      } else if (nonNull.length > 0) {
        obj[key] = nonNull.map(v => sanitizeNode(v, depth + 1));
      }
    }
  }

  // Fix: bare string type in array items
  if (obj.type === "array" && typeof obj.items === "string") {
    obj.items = { type: obj.items };
  }

  // Fix: empty enum
  if (Array.isArray(obj.enum) && obj.enum.length === 0) {
    delete obj.enum;
  }

  // Recurse into properties
  if (obj.properties && typeof obj.properties === "object") {
    obj.properties = mapValues(obj.properties as Record<string, unknown>, v => sanitizeNode(v, depth + 1));
  }

  // Recurse into items
  if (obj.items && typeof obj.items === "object") {
    obj.items = sanitizeNode(obj.items, depth + 1);
  }

  // Recurse into additionalProperties if it's an object
  if (obj.additionalProperties && typeof obj.additionalProperties === "object" && !Array.isArray(obj.additionalProperties)) {
    obj.additionalProperties = sanitizeNode(obj.additionalProperties, depth + 1);
  }

  return obj;
}

function mapValues(
  obj: Record<string, unknown>,
  fn: (v: unknown) => unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = fn(v);
  }
  return result;
}

/** Sanitize all tool schemas in a tool list */
export function sanitizeToolSchemas(
  tools: Array<{ parameters: Record<string, unknown> }>,
): void {
  for (const tool of tools) {
    tool.parameters = sanitizeToolSchema(tool.parameters);
  }
}
