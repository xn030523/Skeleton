/**
 * Text-to-Speech (TTS) and Speech-to-Text (transcription) tools.
 *
 * TTS providers: Edge TTS (free), ElevenLabs, OpenAI
 * Transcription providers: Whisper local, Groq, OpenAI
 *
 * Inspired by Hermes tts_tool.py and transcription_tools.py (simplified).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "./types.js";

type TtsProvider = "edge" | "elevenlabs" | "openai";
type SttProvider = "whisper" | "groq" | "openai";

/** TTS tool — convert text to speech */
export function ttsTool(): ToolDef {
  return {
    name: "tts",
    description: "Convert text to speech audio. Uses Edge TTS by default (free, no API key). Set SKELETON_TTS_PROVIDER for other providers.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to convert to speech" },
        voice: { type: "string", description: "Voice name (default: en-US-AriaNeural)" },
        provider: { type: "string", enum: ["edge", "elevenlabs", "openai"], description: "TTS provider" },
        output_path: { type: "string", description: "Output audio file path (default: temp)" },
      },
      required: ["text"],
    },
    execute: async (args) => {
      const { text, voice = "en-US-AriaNeural", provider, output_path } = args as {
        text: string;
        voice?: string;
        provider?: TtsProvider;
        output_path?: string;
      };
      if (!text.trim()) return "Error: no text provided";

      const ttsProvider = provider ?? process.env.SKELETON_TTS_PROVIDER ?? "edge";
      const outputPath = output_path ?? path.join(process.cwd(), ".skeleton", "tts", `tts_${Date.now()}.mp3`);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      try {
        switch (ttsProvider as TtsProvider) {
          case "edge": {
            // Edge TTS via edge-tts Python package
            try {
              execSync(`edge-tts --voice "${voice}" --text "${text.replace(/"/g, '\\"').slice(0, 5000)}" --write-media "${outputPath}"`, {
                timeout: 30000,
                encoding: "utf-8",
              });
              return `Audio saved to: ${outputPath}`;
            } catch {
              return "Error: edge-tts not installed. Install with: pip install edge-tts";
            }
          }
          case "elevenlabs": {
            const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
            if (!apiKey) return "Error: ELEVENLABS_API_KEY not set";
            const resp = await fetch("https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "xi-api-key": apiKey,
              },
              body: JSON.stringify({ text: text.slice(0, 5000), model_id: "eleven_monolingual_v1" }),
            });
            if (!resp.ok) return `Error: ElevenLabs API returned ${resp.status}`;
            const buffer = Buffer.from(await resp.arrayBuffer());
            fs.writeFileSync(outputPath, buffer);
            return `Audio saved to: ${outputPath}`;
          }
          case "openai": {
            const apiKey = process.env.OPENAI_API_KEY ?? process.env.SKELETON_API_KEY ?? "";
            if (!apiKey) return "Error: OPENAI_API_KEY not set";
            const resp = await fetch("https://api.openai.com/v1/audio/speech", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
              },
              body: JSON.stringify({ model: "tts-1", input: text.slice(0, 4096), voice: "alloy" }),
            });
            if (!resp.ok) return `Error: OpenAI TTS API returned ${resp.status}`;
            const buffer = Buffer.from(await resp.arrayBuffer());
            fs.writeFileSync(outputPath, buffer);
            return `Audio saved to: ${outputPath}`;
          }
          default:
            return `Error: unknown TTS provider "${ttsProvider}"`;
        }
      } catch (err) {
        return `TTS error: ${(err as Error).message}`;
      }
    },
    toolset: "media",
    emoji: "🔊",
  };
}

/** Transcription tool — convert speech to text */
export function transcriptionTool(): ToolDef {
  return {
    name: "transcribe",
    description: "Transcribe audio file to text. Uses Groq Whisper by default (fast, free tier). Set SKELETON_STT_PROVIDER for other providers.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to audio file" },
        language: { type: "string", description: "Language code (e.g. en, zh)" },
        provider: { type: "string", enum: ["whisper", "groq", "openai"], description: "STT provider" },
      },
      required: ["file_path"],
    },
    execute: async (args) => {
      const { file_path, language, provider } = args as {
        file_path: string;
        language?: string;
        provider?: SttProvider;
      };

      if (!fs.existsSync(file_path)) return "Error: audio file not found";

      const sttProvider = provider ?? process.env.SKELETON_STT_PROVIDER ?? "groq";

      try {
        switch (sttProvider as SttProvider) {
          case "groq": {
            const apiKey = process.env.GROQ_API_KEY ?? "";
            if (!apiKey) return "Error: GROQ_API_KEY not set";
            const audioBuffer = fs.readFileSync(file_path);
            const ext = path.extname(file_path).slice(1) || "wav";
            const formData = new FormData();
            formData.append("file", new Blob([audioBuffer]), `audio.${ext}`);
            formData.append("model", "whisper-large-v3");
            if (language) formData.append("language", language);

            const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
              method: "POST",
              headers: { "Authorization": `Bearer ${apiKey}` },
              body: formData,
            });
            if (!resp.ok) return `Error: Groq API returned ${resp.status}`;
            const data = await resp.json() as { text?: string };
            return data.text ?? "(no transcription)";
          }
          case "openai": {
            const apiKey = process.env.OPENAI_API_KEY ?? process.env.SKELETON_API_KEY ?? "";
            if (!apiKey) return "Error: OPENAI_API_KEY not set";
            const audioBuffer = fs.readFileSync(file_path);
            const ext = path.extname(file_path).slice(1) || "wav";
            const formData = new FormData();
            formData.append("file", new Blob([audioBuffer]), `audio.${ext}`);
            formData.append("model", "whisper-1");
            if (language) formData.append("language", language);

            const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
              method: "POST",
              headers: { "Authorization": `Bearer ${apiKey}` },
              body: formData,
            });
            if (!resp.ok) return `Error: OpenAI API returned ${resp.status}`;
            const data = await resp.json() as { text?: string };
            return data.text ?? "(no transcription)";
          }
          case "whisper": {
            try {
              const result = execSync(`whisper "${file_path}" --model base --output_format txt --output_dir "${path.dirname(file_path)}"`, {
                timeout: 120000,
                encoding: "utf-8",
              });
              const txtPath = file_path.replace(/\.[^.]+$/, ".txt");
              if (fs.existsSync(txtPath)) {
                return fs.readFileSync(txtPath, "utf-8");
              }
              return result || "(no transcription)";
            } catch {
              return "Error: whisper not installed. Install with: pip install openai-whisper";
            }
          }
          default:
            return `Error: unknown STT provider "${sttProvider}"`;
        }
      } catch (err) {
        return `Transcription error: ${(err as Error).message}`;
      }
    },
    toolset: "media",
    emoji: "🎙️",
  };
}
