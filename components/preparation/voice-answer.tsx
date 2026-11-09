"use client";
import { useEffect, useRef, useState } from "react";
import type { Request } from "@/lib/api-client";
import {
  MAX_AUDIO_BYTES,
  MAX_RECORDING_SECONDS,
} from "@/lib/practice-audio-limits";
import { AUDIO_PRICE_PER_MINUTE, formatCost } from "@/lib/pricing";
import { Meta } from "../ui/meta";

const AUDIO_MODEL_LABEL = "gpt-4o-mini-transcribe";

// A microphone button for the answer composer. Stopping a recording sends it
// once for transcription and adds the text to the answer draft, which the user
// reviews before sending. A failed transcription keeps the recording for an
// explicit retry. The wrapper uses `display: contents`, so the button sits in
// the composer's action bar and the notes and errors take full rows above it.
export function VoiceAnswer({
  request,
  enabled,
  disabled,
  onTranscript,
  userKey = false,
}: {
  request: Request;
  enabled: boolean;
  disabled: boolean;
  onTranscript: (text: string) => void;
  // Whose OpenAI key pays for transcription, for the cost line.
  userKey?: boolean;
}) {
  const [supported, setSupported] = useState(false),
    [recording, setRecording] = useState(false),
    [blob, setBlob] = useState<Blob | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [transcribing, setTranscribing] = useState(false),
    [added, setAdded] = useState(false),
    [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    abort = useRef<AbortController | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    alive = useRef(true);
  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
  }
  useEffect(() => {
    alive.current = true;
    setSupported(
      !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined",
    );
    return () => {
      alive.current = false;
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
        if (recorder.current.state === "recording") recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      abort.current?.abort();
    };
  }, []);
  async function record() {
    if (busy) return;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setError("");
    setAdded(false);
    setBlob(null);
    setBusy(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      if (!mime) {
        media.getTracks().forEach((t) => t.stop());
        throw new Error("unsupported");
      }
      stream.current = media;
      const rec = new MediaRecorder(media, { mimeType: mime });
      recorder.current = rec;
      const chunks: Blob[] = [];
      let size = 0,
        tooLarge = false;
      rec.ondataavailable = (e) => {
        size += e.data.size;
        if (size > MAX_AUDIO_BYTES) {
          tooLarge = true;
          stop();
          setError("Recording exceeded 3 MB. Record a shorter answer.");
        } else chunks.push(e.data);
      };
      rec.onerror = () => {
        stop();
        setError(
          "Recording failed. Check microphone access or type your answer.",
        );
      };
      rec.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = null;
        if (timer.current) clearInterval(timer.current);
        setRecording(false);
        if (tooLarge) return;
        // Pressing Record, with the terms shown beside it, is the consent to
        // send this one recording; a failure is never retried.
        const recorded = new Blob(chunks, { type: mime });
        setBlob(recorded);
        void transcribe(recorded);
      };
      rec.start(1000);
      setSeconds(0);
      setRecording(true);
      let elapsed = 0;
      timer.current = setInterval(() => {
        elapsed++;
        setSeconds(elapsed);
        if (elapsed >= MAX_RECORDING_SECONDS) stop();
      }, 1000);
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error && e.message === "unsupported"
            ? "This browser has no supported recorder format. Type your answer instead."
            : "Microphone unavailable or permission denied. Allow microphone access for this site, or type your answer.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function transcribe(recorded: Blob | null = blob) {
    if (!recorded || !alive.current) return;
    setBusy(true);
    setTranscribing(true);
    setError("");
    const control = new AbortController();
    abort.current = control;
    try {
      const audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read recording."));
        reader.readAsDataURL(recorded);
      });
      const result = await request<{ text: string }>(
        "/api/practice/transcribe",
        {
          signal: control.signal,
          body: { audio, mime: recorded.type, consent: true },
        },
      );
      if (alive.current && !control.signal.aborted) {
        onTranscript(result.text);
        setBlob(null);
        setAdded(true);
      }
    } catch (e) {
      if (alive.current && !control.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Transcription failed. Your recording is retained.",
        );
    } finally {
      if (alive.current) {
        setBusy(false);
        setTranscribing(false);
      }
      abort.current = null;
    }
  }
  const unavailable = !supported
    ? "Recording needs a supported browser on HTTPS or localhost."
    : !enabled
      ? "Voice answers need OpenAI. Choose it in model settings, or keep typing."
      : "";
  const length = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const kept = !!blob && !transcribing;
  // One button for every step, so keyboard focus never falls off a removed one.
  const step = recording
    ? { label: "Stop and transcribe", run: stop, primary: true }
    : transcribing
      ? {
          label: "Cancel transcription",
          run: () => abort.current?.abort(),
          primary: false,
        }
      : kept
        ? {
            label: `Retry transcription · ≈ ${formatCost((Math.max(seconds, 1) / 60) * AUDIO_PRICE_PER_MINUTE)}`,
            run: () => void transcribe(),
            primary: true,
          }
        : { label: "Record answer", run: () => void record(), primary: false };
  // Not disabled while the microphone opens: a disabled button drops focus.
  const blocked =
    !recording &&
    !transcribing &&
    (!!unavailable || disabled || (kept && busy));
  return (
    <div className="voice-answer">
      <button
        type="button"
        className={`button small${step.primary ? "" : " secondary"}${recording ? " recording" : ""}`}
        disabled={blocked}
        aria-describedby={unavailable ? "voice-unavailable" : "voice-terms"}
        onClick={step.run}
      >
        <MicIcon /> {step.label}
      </button>
      {kept && (
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={() => {
            setBlob(null);
            setError("");
          }}
        >
          Discard recording
        </button>
      )}
      {(recording || transcribing || kept) && (
        // The timer lives outside the button, so its label stays stable.
        <span
          className="tiny muted voice-status"
          role={transcribing ? "status" : undefined}
        >
          {recording
            ? `Recording · ${length}`
            : transcribing
              ? `Transcribing ${length} of audio…`
              : `Recording kept · ${length}`}
        </span>
      )}
      {unavailable ? (
        <span id="voice-unavailable" className="tiny muted">
          {unavailable}
        </span>
      ) : (
        // Shown before recording: pressing Record is consent to send it.
        <div id="voice-terms" className="voice-terms">
          <Meta
            items={[
              "Voice: sent to OpenAI when you stop",
              AUDIO_MODEL_LABEL,
              userKey ? "your OpenAI key" : "the server's key",
              `≈ ${formatCost(AUDIO_PRICE_PER_MINUTE)} per minute`,
              "up to 2:00",
              "never saved",
            ]}
          />
        </div>
      )}
      {added && (
        <span role="status" className="tiny muted">
          Transcript added to your answer. Review it before sending.
        </span>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
    </svg>
  );
}
