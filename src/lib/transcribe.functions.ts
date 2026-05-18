import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway";

const inputSchema = z.object({
  mediaUrl: z.string().url(),
  mediaType: z.string().min(1).max(100),
  fileName: z.string().max(255).optional(),
  styleGuide: z.string().max(10000).default(""),
  styleGuidePdfUrl: z.string().url().optional(),
  styleGuidePdfName: z.string().max(255).optional(),
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

    const hasTextGuide = data.styleGuide.trim().length > 0;
    const hasPdfGuide = !!data.styleGuidePdfUrl;

    const styleInstructions = hasPdfGuide
      ? "A style guide PDF is attached. Read it carefully end-to-end and follow EVERY rule it specifies (tone, formatting, spelling, punctuation, what to omit, speaker labels, capitalization, numbers, abbreviations, etc.)."
      : hasTextGuide
        ? `Follow this style guide strictly when producing the transcript:\n\n${data.styleGuide.trim()}`
        : "Produce a clean, faithful transcript with proper punctuation and paragraph breaks.";

    const system = [
      "You are an elite professional transcriptionist with native-level fluency.",
      "Your job: produce a verbatim, 100% accurate transcript of the supplied audio or video file.",
      "Listen critically to the ENTIRE file end-to-end. Do not summarize, paraphrase, or omit any spoken content unless the style guide instructs you to.",
      "Be exact with names, numbers, technical terms, and quoted material. If a phrase is unclear, mark it as [inaudible] rather than guess.",
      "Use speaker labels (Speaker 1, Speaker 2, ...) when multiple speakers are clearly distinguishable; use the speaker's actual name if it is stated in the audio.",
      "After drafting, mentally re-check the transcript against the audio for typos, missed words, and style-guide violations before finalizing.",
      "Return ONLY the final transcript text — no preamble, no commentary, no markdown code fences.",
      styleInstructions,
    ].join("\n\n");

    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "file"; data: URL; mediaType: string }
    > = [
      {
        type: "text",
        text: `Transcribe this ${data.mediaType.startsWith("video") ? "video" : "audio"} file${data.fileName ? ` (${data.fileName})` : ""}${hasPdfGuide ? `, strictly following the attached style guide PDF${data.styleGuidePdfName ? ` (${data.styleGuidePdfName})` : ""}` : " following the style guide"}. Be thorough and 100% accurate.`,
      },
      {
        type: "file",
        data: new URL(data.mediaUrl),
        mediaType: data.mediaType,
      },
    ];

    if (data.styleGuidePdfUrl) {
      userContent.push({
        type: "file",
        data: new URL(data.styleGuidePdfUrl),
        mediaType: "application/pdf",
      });
    }

    try {
      const { text } = await generateText({
        model,
        system,
        messages: [{ role: "user", content: userContent }],
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
