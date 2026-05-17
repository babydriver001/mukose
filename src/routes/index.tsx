import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useRef, useState } from "react";
import { transcribeMedia } from "@/lib/transcribe.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FileAudio, Upload, Copy, Check, Loader2, Wand2, FileText, X } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Scribe — Style-aware audio & video transcription" },
      {
        name: "description",
        content:
          "Upload an audio or video file with a style guide and get a clean, on-brand transcript powered by AI.",
      },
    ],
  }),
  component: Index,
});

const MAX_BYTES = 18 * 1024 * 1024; // ~18MB — keep room for base64 overhead

const EXAMPLE_STYLE = `• Use US English spelling.
• Remove filler words (um, uh, like, you know).
• Use short paragraphs separated by blank lines.
• Format speaker turns as "Name: " when speakers are named.
• Spell out numbers under 10; use digits for 10+.
• Use the Oxford comma.`;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Index() {
  const transcribe = useServerFn(transcribeMedia);
  const [file, setFile] = useState<File | null>(null);
  const [styleGuide, setStyleGuide] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const sizeOk = useMemo(() => !file || file.size <= MAX_BYTES, [file]);

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

  const onSubmit = useCallback(async () => {
    if (!file) {
      setError("Add an audio or video file first.");
      return;
    }
    if (!sizeOk) {
      setError(`File is too large. Max ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    setLoading(true);
    setError(null);
    setTranscript("");
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await transcribe({
        data: {
          fileBase64,
          mediaType: file.type,
          styleGuide,
          fileName: file.name,
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
      setLoading(false);
    }
  }, [file, sizeOk, styleGuide, transcribe]);

  const onCopy = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
      <div className="mx-auto max-w-5xl px-6 py-12 md:py-20">
        <header className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Wand2 className="h-3.5 w-3.5" />
            AI-powered transcription
          </div>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            Transcribe to your own style guide
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-muted-foreground">
            Drop in an audio or video file and the rules you write by. Get back
            a transcript that already sounds like you.
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
                      mp3, wav, m4a, mp4, mov, webm — up to {formatBytes(MAX_BYTES)}
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
              className="mt-3 h-[180px] resize-none"
              maxLength={10000}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Optional but recommended. {styleGuide.length}/10000
            </p>
          </Card>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3">
          <Button
            size="lg"
            onClick={onSubmit}
            disabled={loading || !file || !sizeOk}
            className="min-w-[220px]"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Transcribing…
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                Transcribe
              </>
            )}
          </Button>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {loading && (
            <p className="text-xs text-muted-foreground">
              This can take a minute for longer files — the model is listening
              end-to-end.
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
