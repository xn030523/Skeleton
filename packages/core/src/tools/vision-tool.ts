import type { ToolDef } from "../types.js";
import { AuxiliaryClient, buildAuxiliaryClient } from "../auxiliary-client.js";
import type { LLMConfig } from "../types.js";

let auxClient: AuxiliaryClient | null = null;

function getAuxClient(): AuxiliaryClient {
  if (auxClient) return auxClient;
  const config: LLMConfig = {
    protocol: (process.env.SKELETON_AUX_PROTOCOL as LLMConfig["protocol"]) ?? "openai",
    apiKey: process.env.SKELETON_AUX_API_KEY ?? process.env.SKELETON_API_KEY ?? "",
    baseUrl: process.env.SKELETON_AUX_BASE_URL ?? "https://api.openai.com/v1",
    model: process.env.SKELETON_AUX_MODEL ?? "gpt-4o",
    maxTokens: 1024,
    temperature: 0.3,
  };
  auxClient = new AuxiliaryClient(config);
  return auxClient;
}

async function imageUrlToBase64(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith("data:")) return imageUrl;

  const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const contentType = resp.headers.get("content-type") ?? "image/png";
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export function visionTool(): ToolDef {
  return {
    name: "vision_analyze",
    description:
      "Analyze an image from a URL with a custom question. " +
      "Downloads the image, converts to base64, and dispatches to the auxiliary vision router. " +
      "Set SKELETON_AUX_* env vars to configure the vision model.",
    parameters: {
      type: "object",
      properties: {
        image_url: {
          type: "string",
          description: "URL or data URI of the image to analyze",
        },
        question: {
          type: "string",
          description: "Question to ask about the image",
        },
      },
      required: ["image_url", "question"],
    },
    execute: async (args) => {
      const { image_url, question } = args as {
        image_url: string;
        question: string;
      };

      if (!image_url?.trim()) return { error: "image_url is required" };
      if (!question?.trim()) return { error: "question is required" };

      try {
        const base64Data = await imageUrlToBase64(image_url);
        const client = getAuxClient();
        const analysis = await client.analyzeImage(base64Data, question);

        return {
          image_url,
          question,
          analysis,
        };
      } catch (err) {
        return { error: `Vision analysis failed: ${(err as Error).message}` };
      }
    },
    toolset: "vision",
  };
}

export function setAuxClientForVision(client: AuxiliaryClient): void {
  auxClient = client;
}
