import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useRef, useState } from "react";
import { transcribeMedia } from "@/lib/transcribe.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  FileAudio,
  Upload,
  Copy,
  Check,
  Loader2,
  Wand2,
  FileText,
  X,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Scribe — Style-aware audio & video transcription" },
      {
        name: "description",
        content:
          "Upload audio or video (up to 500MB) plus a PDF style guide and get a thorough, on-brand transcript powered by AI.",
      },
    ],
  }),
  component: Index,
});

const BUCKET = "transcribe-uploads";
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB

const EXAMPLE_STYLE = `• Use US English spelling.
• Remove filler words (um, uh, like, you know).
• Use short paragraphs separated by blank lines.
• Format speaker turns as "Name: " when speakers are named.
• Spell out numbers under 10; use digits for 10+.
• Use the Oxford comma.`;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function randomKey(file: File) {
  const ext = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf("."))
    : "";
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${id}${ext}`;
}

async function uploadToStorage(
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  const key = randomKey(file);
  // supabase-js v2 upload doesn't expose progress; do an indeterminate spin then jump to 100.
  onProgress(5);
  const tick = setInterval(() => {
    onProgress((p) => Math.min(p + 3, 90) as never as number);
  }, 400);
  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(key, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });
    if (error) throw error;
  } finally {
    clearInterval(tick);
  }
  onProgress(100);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

function Index() {
  const transcribe = useServerFn(transcribeMedia);
  const [file, setFile] = useState<File | null>(null);
  const [styleGuide, setStyleGuide] = useState("");
  const [styleGuidePdf, setStyleGuidePdf] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<
    "idle" | "uploading-media" | "uploading-pdf" | "transcribing"
  >("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const loading = stage !== "idle";
  const sizeOk = useMemo(() => !file || file.size <= MAX_BYTES, [file]);
  const pdfSizeOk = useMemo(
    () => !styleGuidePdf || styleGuidePdf.size <= MAX_BYTES,
    [styleGuidePdf],
  );

  const handleFile = (f: File | null | undefined) => {
    if (!f) return;
    setError(null);
    setTranscript("");
    if (!/^(audio|video)\//.test(f.type)) {
      setError("Please choose an audio or video file.");
      return;
    }
    setFile(f);
  };

  const handlePdf = (f: File | null | undefined) => {
    if (!f) return;
    setError(null);
    if (
      f.type !== "application/pdf" &&
      !f.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("Style guide must be a PDF.");
      return;
    }
    setStyleGuidePdf(f);
  };

  const onSubmit = useCallback(async () => {
    if (!file) {
      setError("Add an audio or video file first.");
      return;
    }
    if (!sizeOk) {
      setError(`File is too large. Max ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    if (!pdfSizeOk) {
      setError(`Style guide PDF is too large. Max ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    setError(null);
    setTranscript("");
    setUploadPct(0);
    try {
      setStage("uploading-media");
      const mediaUrl = await uploadToStorage(file, (p) =>
        setUploadPct(typeof p === "function" ? p : p),
      );

      let styleGuidePdfUrl: string | undefined;
      if (styleGuidePdf) {
        setStage("uploading-pdf");
        setUploadPct(0);
        styleGuidePdfUrl = await uploadToStorage(styleGuidePdf, (p) =>
          setUploadPct(typeof p === "function" ? p : p),
        );
      }

      setStage("transcribing");
      const res = await transcribe({
        data: {
          mediaUrl,
          mediaType: file.type,
          fileName: file.name,
          styleGuide,
          styleGuidePdfUrl,
          styleGuidePdfName: styleGuidePdf?.name,
        },
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        setTranscript(res.transcript);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setStage("idle");
      setUploadPct(0);
    }
  }, [file, sizeOk, pdfSizeOk, styleGuide, styleGuidePdf, transcribe]);

  const onCopy = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const stageLabel =
    stage === "uploading-media"
      ? "Uploading media…"
      : stage === "uploading-pdf"
        ? "Uploading style guide…"
        : stage === "transcribing"
          ? "Transcribing — analyzing the full file…"
          : "";

  return (
    <main className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
      <div className="mx-auto max-w-5xl px-6 py-12 md:py-20">
        <header className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Wand2 className="h-3.5 w-3.5" />
            AI-powered transcription · up to {formatBytes(MAX_BYTES)}
          </div>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            Transcribe to your own style guide
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-muted-foreground">
            Drop in audio or video and a PDF style guide. The model listens
            end-to-end and returns a thorough, accurate transcript formatted to
            your rules.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-6">
            <Label className="text-sm font-medium">1. Media file</Label>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFile(e.dataTransfer.files?.[0]);
              }}
              className={`mt-3 flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/50"
              }`}
            >
              {file ? (
                <>
                  <FileAudio className="h-8 w-8 text-primary" />
                  <div className="text-center">
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.size)} · {file.type}
                    </p>
                  </div>
                  {!sizeOk && (
                    <Badge variant="destructive">
                      Too large (max {formatBytes(MAX_BYTES)})
                    </Badge>
                  )}
                </>
              ) : (
                <>
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium">
                      Click or drop audio / video
                    </p>
                    <p className="text-xs text-muted-foreground">
                      mp3, wav, m4a, mp4, mov, webm — up to{" "}
                      {formatBytes(MAX_BYTES)}
                    </p>
                  </div>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </button>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <Label htmlFor="style" className="text-sm font-medium">
                2. Style guide
              </Label>
              <button
                type="button"
                onClick={() => setStyleGuide(EXAMPLE_STYLE)}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Use example
              </button>
            </div>
            <Textarea
              id="style"
              value={styleGuide}
              onChange={(e) => setStyleGuide(e.target.value)}
              placeholder="Describe tone, formatting rules, speaker labels, spelling preferences, what to omit…"
              className="mt-3 h-[140px] resize-none"
              maxLength={10000}
              disabled={!!styleGuidePdf}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {styleGuidePdf
                ? "Disabled — the attached PDF will be used as the style guide."
                : `Optional but recommended. ${styleGuide.length}/10000`}
            </p>

            <div className="mt-4 border-t pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Or upload a PDF style guide
              </p>
              {styleGuidePdf ? (
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {styleGuidePdf.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(styleGuidePdf.size)}
                        {!pdfSizeOk &&
                          ` · too large (max ${formatBytes(MAX_BYTES)})`}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setStyleGuidePdf(null)}
                    aria-label="Remove PDF"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => pdfInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50"
                >
                  <Upload className="h-4 w-4" />
                  Upload PDF
                </button>
              )}
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => handlePdf(e.target.files?.[0])}
              />
            </div>
          </Card>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3">
          <Button
            size="lg"
            onClick={onSubmit}
            disabled={loading || !file || !sizeOk || !pdfSizeOk}
            className="min-w-[240px]"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {stage === "transcribing" ? "Transcribing…" : "Uploading…"}
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                Transcribe
              </>
            )}
          </Button>
          {loading && (
            <div className="w-full max-w-md space-y-2">
              <p className="text-center text-xs text-muted-foreground">
                {stageLabel}
              </p>
              {stage !== "transcribing" && <Progress value={uploadPct} />}
              {stage === "transcribing" && (
                <p className="text-center text-xs text-muted-foreground">
                  Long files can take several minutes — the model is listening
                  end-to-end for full accuracy.
                </p>
              )}
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        {transcript && (
          <Card className="mt-10 p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium">Transcript</h2>
              <Button variant="ghost" size="sm" onClick={onCopy}>
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" /> Copy
                  </>
                )}
              </Button>
            </div>
            <div className="whitespace-pre-wrap rounded-md bg-muted/40 p-4 text-sm leading-relaxed">
              {transcript}
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
