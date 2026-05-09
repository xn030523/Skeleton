import type { ToolDef } from "../types.js";

const VISION_MODEL_PATTERNS = [
  /gpt-4[o0]/i,
  /gpt-4-turbo/i,
  /gpt-4o/i,
  /claude-3[.-](opus|sonnet|haiku)/i,
  /claude-3\.5/i,
  /gemini-[12]/i,
  /gemini-pro-vision/i,
  /llava/i,
  /qwen-vl/i,
  /cogvlm/i,
  /internvl/i,
  /pixtral/i,
  /vision/i,
];

function isVisionCapable(model: string): boolean {
  return VISION_MODEL_PATTERNS.some((p) => p.test(model));
}

export type ImageRouteMode = "native" | "text" | "auto";

export interface ImageRouteResult {
  mode: "native" | "text";
  content: string;
}

export async function routeImage(
  imageUrl: string,
  model: string,
  visionFn?: (url: string) => Promise<string>,
): Promise<ImageRouteResult> {
  const resolvedMode: "native" | "text" = isVisionCapable(model) ? "native" : "text";

  if (resolvedMode === "native") {
    return {
      mode: "native",
      content: JSON.stringify({
        type: "image_url",
        image_url: { url: imageUrl },
      }),
    };
  }

  if (!visionFn) {
    return {
      mode: "text",
      content: `[Image attached: ${imageUrl}] (vision analysis unavailable — no visionFn provided)`,
    };
  }

  try {
    const description = await visionFn(imageUrl);
    return {
      mode: "text",
      content: `[Image description: ${description}]\n\nImage URL: ${imageUrl}`,
    };
  } catch (err) {
    return {
      mode: "text",
      content: `[Image attached: ${imageUrl}] (vision analysis failed: ${(err as Error).message})`,
    };
  }
}
