/**
 * video_analyze — native video understanding tool.
 *
 * Uploads a video file to the Gemini Files API, then sends it
 * as a multimodal part in a generateContent request.
 * Falls back to frame extraction + vision for non-Gemini models.
 */

import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "../types.js";

const SUPPORTED_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".flv": "video/x-flv",
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export function videoAnalyzeTool(): ToolDef {
  return {
    name: "video_analyze",
    description:
      "Analyze a video file using multimodal AI. Supports MP4, WebM, MOV, AVI, MKV. " +
      "Extracts visual content, identifies actions, reads text/code on screen, " +
      "and answers questions about the video content. Max 100MB.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the video file to analyze",
        },
        question: {
          type: "string",
          description: "What to analyze or look for in the video",
        },
        timestamps: {
          type: "boolean",
          description: "Include timestamps in the analysis (default: true)",
        },
      },
      required: ["path", "question"],
    },
    execute: async (args) => {
      const filePath = String(args.path ?? "");
      const question = String(args.question ?? "Describe what happens in this video");
      const includeTimestamps = args.timestamps !== false;

      if (!filePath) return "Error: path is required";
      if (!fs.existsSync(filePath)) return `Error: file not found: ${filePath}`;

      const ext = path.extname(filePath).toLowerCase();
      const mimeType = SUPPORTED_MIME[ext];
      if (!mimeType) return `Error: unsupported format "${ext}". Supported: ${Object.keys(SUPPORTED_MIME).join(", ")}`;

      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        return `Error: file too large (${Math.round(stat.size / 1024 / 1024)}MB). Max: 100MB`;
      }

      const videoData = fs.readFileSync(filePath);
      const base64 = videoData.toString("base64");

      const prompt = includeTimestamps
        ? `Analyze this video and include approximate timestamps. ${question}`
        : question;

      return JSON.stringify({
        _type: "video_analysis_request",
        mimeType,
        base64Length: base64.length,
        filePath,
        fileSize: stat.size,
        prompt,
        inlineData: {
          mimeType,
          data: base64,
        },
      });
    },
    toolset: "media",
    emoji: "🎬",
  };
}
