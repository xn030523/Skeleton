/**
 * LM Studio first-class helpers — live model listing + reasoning transport hints.
 *
 * LM Studio exposes OpenAI-compatible /v1/models that returns locally loaded models.
 * Unlike cloud providers, this is cheap to query and reflects what's actually available.
 */

export interface LMStudioModel {
  id: string;
  object: string;
  owned_by: string;
  /** Context window size if reported */
  max_context_length?: number;
  /** Loaded into memory (LM Studio specific) */
  loaded?: boolean;
}

/** Fetch currently available models from LM Studio */
export async function listLMStudioModels(baseUrl = "http://localhost:1234"): Promise<LMStudioModel[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;
  try {
    const resp = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { data?: LMStudioModel[] };
    return data.data ?? [];
  } catch {
    return [];
  }
}

/** Check if LM Studio is reachable */
export async function isLMStudioReachable(baseUrl = "http://localhost:1234"): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
      signal: AbortSignal.timeout(2_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Detect if a model name hints at reasoning capabilities */
export function isReasoningModel(modelId: string): boolean {
  const reasoning = [
    "o1", "o3", "r1", "deepseek-r1", "qwq", "marco-o1",
    "thinking", "reasoning", "reason",
  ];
  const lower = modelId.toLowerCase();
  return reasoning.some(r => lower.includes(r));
}

/** Get LM Studio doctor-style diagnostics */
export async function lmStudioDoctor(baseUrl = "http://localhost:1234"): Promise<{
  reachable: boolean;
  models: number;
  loadedModel?: string;
  baseUrl: string;
  issues: string[];
}> {
  const issues: string[] = [];
  const reachable = await isLMStudioReachable(baseUrl);

  if (!reachable) {
    issues.push(`Cannot reach ${baseUrl} — ensure LM Studio is running with "Start Server" enabled`);
    return { reachable: false, models: 0, baseUrl, issues };
  }

  const models = await listLMStudioModels(baseUrl);
  if (models.length === 0) {
    issues.push("LM Studio is running but no models are loaded. Load a model in LM Studio first.");
  }

  const loadedModel = models.find(m => m.loaded !== false)?.id;

  return {
    reachable,
    models: models.length,
    loadedModel,
    baseUrl,
    issues,
  };
}
