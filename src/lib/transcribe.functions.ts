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

    try {
      // ── PASS 1: Deep style-guide analysis ──────────────────────────────
      let styleGuideAnalysis = "";
      if (hasPdfGuide) {
        const analysisSystem = [
          "You are a meticulous style-guide analyst.",
          "You will receive a style guide PDF. Read it END-TO-END, page by page, from the very first page to the very last page. Do not skip any page, footnote, sidebar, table, or appendix.",
          "Your output is an EXHAUSTIVE working specification that another writer will follow to produce a transcript. It must be specific enough that the writer never has to open the PDF.",
          "Structure your output with these sections:",
          "  1. SCOPE & VOICE — tone, register, audience, perspective.",
          "  2. SPELLING & LANGUAGE — variety (US/UK/etc.), word lists, preferred/forbidden words.",
          "  3. PUNCTUATION — commas (Oxford?), quotes, dashes, ellipses, colons, semicolons.",
          "  4. CAPITALIZATION — titles, headings, proper nouns, job titles, product names.",
          "  5. NUMBERS, DATES, TIMES, UNITS, CURRENCY — full rules with thresholds.",
          "  6. ABBREVIATIONS & ACRONYMS — when to expand, when to abbreviate, plurals, possessives.",
          "  7. FORMATTING — paragraphs, line breaks, lists, headings, emphasis, block quotes.",
          "  8. SPEAKER LABELS & DIALOGUE — naming, attribution, turn-taking, interruptions.",
          "  9. DISFLUENCIES & VERBATIM POLICY — fillers (um/uh/like), false starts, repetitions, laughter, [crosstalk], [inaudible].",
          " 10. INCLUSIVE / SENSITIVE LANGUAGE — required phrasings and forbidden terms.",
          " 11. DOMAIN-SPECIFIC RULES — names, technical terms, brand voice, legal/medical/etc.",
          " 12. EXAMPLES — every concrete example from the guide, kept verbatim with its rule.",
          " 13. EXCEPTIONS & EDGE CASES — list every exception explicitly and WHEN to apply it.",
          " 14. CHECKLIST — a numbered final-pass checklist to verify before delivering the transcript.",
          "For EACH rule cite the page or section it came from in parentheses, e.g. (p. 7).",
          "If the guide contradicts itself, note the contradiction and pick the most specific or most recent rule.",
          "Return ONLY the specification. No preamble, no markdown code fences.",
        ].join("\n");

        const analysisResult = await generateText({
          model,
          system: analysisSystem,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Analyse this style guide${data.styleGuidePdfName ? ` (${data.styleGuidePdfName})` : ""} thoroughly, page by page, from page 1 to the last page. Capture every example, exception, and condition with its location. Do not summarise — be exhaustive.`,
                },
                {
                  type: "file",
                  data: new URL(data.styleGuidePdfUrl!),
                  mediaType: "application/pdf",
                },
              ],
            },
          ],
        });
        styleGuideAnalysis = analysisResult.text;
      }

      // ── PASS 2: Transcription guided by the analysis ───────────────────
      const styleInstructions = hasPdfGuide
        ? `You will follow this WORKING SPECIFICATION (derived from a full page-by-page read of the user's style guide PDF). Apply EVERY rule, example, and exception. The attached PDF is also included as the source of truth — defer to it if anything is unclear.\n\n=== STYLE GUIDE SPECIFICATION ===\n${styleGuideAnalysis}\n=== END SPECIFICATION ===`
        : hasTextGuide
          ? `Follow this style guide strictly when producing the transcript:\n\n${data.styleGuide.trim()}`
          : "Produce a clean, faithful transcript with proper punctuation and paragraph breaks.";

      const system = [
        "You are an elite professional transcriptionist with native-level fluency.",
        "Your job: produce a verbatim, 100% accurate transcript of the supplied audio or video file, with ZERO style-guide violations.",
        "Process:",
        "  1. Listen to the ENTIRE file end-to-end. Do not summarise, paraphrase, or omit content unless the style guide instructs you to.",
        "  2. Be exact with names, numbers, technical terms, and quoted material. Mark genuine ambiguity as [inaudible] rather than guessing.",
        "  3. Use speaker labels per the style guide; if the guide is silent, use 'Speaker 1', 'Speaker 2', or the speaker's stated name.",
        "  4. After drafting, perform a FULL pass against the style-guide checklist. Fix every violation. Then do a second pass for typos and missed words.",
        "Return ONLY the final transcript text — no preamble, no commentary, no markdown code fences.",
        styleInstructions,
      ].join("\n\n");

      const userContent: Array<
        | { type: "text"; text: string }
        | { type: "file"; data: URL; mediaType: string }
      > = [
        {
          type: "text",
          text: `Transcribe this ${data.mediaType.startsWith("video") ? "video" : "audio"} file${data.fileName ? ` (${data.fileName})` : ""}${hasPdfGuide ? ", applying every rule, example, and exception from the style guide specification above and the attached PDF" : " following the style guide"}. Be thorough, exhaustive, and 100% accurate.`,
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

      const { text } = await generateText({
        model,
        system,
        messages: [{ role: "user", content: userContent }],
      });

      return {
        ok: true as const,
        transcript: text,
        styleGuideAnalysis: styleGuideAnalysis || undefined,
      };
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
