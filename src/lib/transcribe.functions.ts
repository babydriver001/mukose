import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway";

const inputSchema = z.object({
  fileBase64: z.string().min(1),
  mediaType: z.string().min(1).max(100),
  styleGuide: z.string().max(10000).default(""),
  fileName: z.string().max(255).optional(),
});

export const transcribeMedia = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        ok: false as const,
        error:
          "AI gateway is not configured. The LOVABLE_API_KEY secret is missing.",
      };
    }

    const gateway = createLovableAiGatewayProvider(apiKey);
    const model = gateway("google/gemini-2.5-pro");

    const styleInstructions = data.styleGuide.trim()
      ? `Follow this style guide strictly when producing the transcript:\n\n${data.styleGuide.trim()}`
      : "Produce a clean, faithful transcript with proper punctuation and paragraph breaks.";

    const system = [
      "You are an expert transcriptionist.",
      "Transcribe the spoken content from the supplied audio or video file verbatim, then format it according to the user's style guide.",
      "Preserve speaker meaning. Use speaker labels (Speaker 1, Speaker 2, ...) only if multiple speakers are clearly distinguishable.",
      "Return ONLY the final transcript text — no preamble, no commentary, no markdown code fences.",
      styleInstructions,
    ].join("\n\n");

    let buffer: Buffer;
    try {
      buffer = Buffer.from(data.fileBase64, "base64");
    } catch {
      return { ok: false as const, error: "Invalid file encoding." };
    }

    try {
      const { text } = await generateText({
        model,
        system,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Transcribe this ${data.mediaType.startsWith("video") ? "video" : "audio"} file${data.fileName ? ` (${data.fileName})` : ""} following the style guide.`,
              },
              {
                type: "file",
                data: buffer,
                mediaType: data.mediaType,
              },
            ],
          },
        ],
      });

      return { ok: true as const, transcript: text };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Transcription failed:", message);
      if (message.includes("429")) {
        return {
          ok: false as const,
          error: "Rate limit hit. Please wait a moment and try again.",
        };
      }
      if (message.includes("402")) {
        return {
          ok: false as const,
          error:
            "AI credits exhausted. Add credits in Settings → Workspace → Usage.",
        };
      }
      return {
        ok: false as const,
        error: `Transcription failed: ${message}`,
      };
    }
  });
