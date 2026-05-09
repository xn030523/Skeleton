import type { ToolDef } from "../types.js";

const FAL_MODELS: Record<string, string> = {
  "fast-sdxl": "fal-ai/fast-sdxl",
  "sdxl": "fal-ai/stable-diffusion-xl",
  "flux": "fal-ai/flux/dev",
  "flux-schnell": "fal-ai/flux/schnell",
  "flux-pro": "fal-ai/flux-pro",
  "ideogram": "fal-ai/ideogram/v2",
};

const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

export function imageGenTool(): ToolDef {
  return {
    name: "image_generate",
    description:
      "Generate images from text prompts via FAL.ai API. " +
      "Supports multiple models (fast-sdxl, sdxl, flux, flux-schnell, flux-pro, ideogram). " +
      "Set SKELETON_FAL_API_KEY environment variable.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Image generation prompt",
        },
        model: {
          type: "string",
          default: "fast-sdxl",
          description: "Model to use: fast-sdxl, sdxl, flux, flux-schnell, flux-pro, ideogram",
        },
        aspect_ratio: {
          type: "string",
          default: "1:1",
          description: "Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3",
        },
        seed: {
          type: "number",
          description: "Random seed for reproducibility (optional)",
        },
      },
      required: ["prompt"],
    },
    execute: async (args) => {
      const {
        prompt,
        model = "fast-sdxl",
        aspect_ratio = "1:1",
        seed,
      } = args as {
        prompt: string;
        model?: string;
        aspect_ratio?: string;
        seed?: number;
      };

      if (!prompt?.trim()) return { error: "Empty prompt" };

      const apiKey = process.env.SKELETON_FAL_API_KEY ?? "";
      if (!apiKey) return { error: "SKELETON_FAL_API_KEY not set" };

      const falModelId = FAL_MODELS[model];
      if (!falModelId) return { error: `Unknown model: ${model}. Available: ${Object.keys(FAL_MODELS).join(", ")}` };

      if (!ASPECT_RATIOS.includes(aspect_ratio)) {
        return { error: `Invalid aspect ratio: ${aspect_ratio}. Available: ${ASPECT_RATIOS.join(", ")}` };
      }

      const body: Record<string, unknown> = {
        prompt,
        image_size: aspect_ratio,
      };
      if (seed !== undefined) body.seed = seed;

      try {
        const resp = await fetch(`https://fal.run/${falModelId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Key ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "");
          return { error: `FAL.ai API error ${resp.status}: ${errText.slice(0, 500)}` };
        }

        const data = await resp.json() as { images?: Array<{ url: string }> };
        const images = data.images ?? [];
        if (images.length === 0) return { error: "No images returned from API" };

        return {
          model,
          prompt,
          images: images.map((img) => img.url),
          image_count: images.length,
        };
      } catch (err) {
        return { error: `Image generation failed: ${(err as Error).message}` };
      }
    },
    toolset: "media",
  };
}
