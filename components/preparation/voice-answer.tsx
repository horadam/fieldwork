"use client";
import { useEffect, useRef, useState } from "react";
import type { Request } from "@/lib/api-client";

// No recording leaves the browser until the user presses Transcribe.
export function VoiceAnswer({
  request,
  enabled,
  disabled,
  onTranscript,
  prompt,
}: {
  request: Request;
  enabled: boolean;
  disabled: boolean;
  onTranscript: (text: string) => void;
  prompt: string;
}) {
  const [supported, setSupported] = useState(false),
    [recording, setRecording] = useState(false),
    [blob, setBlob] = useState<Blob | null>(null),
    [preview, setPreview] = useState(""),
    [transcript, setTranscript] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [seconds, setSeconds] = useState(0),
    [localVoice, setLocalVoice] = useState<SpeechSynthesisVoice | null>(null);
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
    const voices = () =>
      setLocalVoice(
        typeof speechSynthesis !== "undefined"
          ? speechSynthesis
              .getVoices()
              .find((v) => v.localService && v.lang.startsWith("en")) || null
          : null,
      );
    voices();
    if (typeof speechSynthesis !== "undefined")
      speechSynthesis.addEventListener("voiceschanged", voices);
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
      if (typeof speechSynthesis !== "undefined") {
        speechSynthesis.cancel();
        speechSynthesis.removeEventListener("voiceschanged", voices);
      }
    };
  }, []);
  useEffect(() => {
    if (!blob) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  async function record() {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setError("");
    setTranscript("");
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
        throw new Error(
          "This browser has no supported recorder format. Type your answer instead.",
        );
      }
      stream.current = media;
      const rec = new MediaRecorder(media, { mimeType: mime });
      recorder.current = rec;
      const chunks: Blob[] = [];
      let size = 0,
        tooLarge = false;
      rec.ondataavailable = (e) => {
        size += e.data.size;
        if (size > 5 * 1024 * 1024) {
          tooLarge = true;
          stop();
          setError("Recording exceeded 5 MB. Record a shorter answer.");
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
        if (!tooLarge) setBlob(new Blob(chunks, { type: mime }));
      };
      rec.start(1000);
      setSeconds(0);
      setRecording(true);
      let elapsed = 0;
      timer.current = setInterval(() => {
        elapsed++;
        setSeconds(elapsed);
        if (elapsed >= 120) stop();
      }, 1000);
    } catch {
      if (alive.current)
        setError(
          "Microphone unavailable or permission denied. Allow microphone access for this site, or type your answer.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function transcribe() {
    if (!blob) return;
    setBusy(true);
    setError("");
    const control = new AbortController();
    abort.current = control;
    try {
      const audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read recording."));
        reader.readAsDataURL(blob);
      });
      const result = await request<{ text: string }>(
        "/api/practice/transcribe",
        {
          signal: control.signal,
          body: { audio, mime: blob.type, consent: true },
        },
      );
      if (alive.current && !control.signal.aborted) setTranscript(result.text);
    } catch (e) {
      if (alive.current && !control.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Transcription failed. Your recording is retained.",
        );
    } finally {
      if (alive.current) setBusy(false);
      abort.current = null;
    }
  }
  return (
    <details className="voice-answer">
      <summary>Voice options</summary>
      <p className="tiny muted">
        Record up to two minutes. The recording stays in memory until you choose
        to send it through this server to OpenAI for transcription. Audio is not
        saved by this app. Transcription is billed separately and excluded from
        text cost estimates.
      </p>
      <div className="actions">
        <button
          className="button secondary small"
          disabled={!localVoice || disabled || recording}
          onClick={() => {
            if (localVoice) {
              speechSynthesis.cancel();
              const utterance = new SpeechSynthesisUtterance(prompt);
              utterance.voice = localVoice;
              speechSynthesis.speak(utterance);
            }
          }}
        >
          Read question aloud · device voice
        </button>
        <button
          className="button secondary small"
          onClick={() => {
            if (typeof speechSynthesis !== "undefined")
              speechSynthesis.cancel();
          }}
        >
          Stop reading
        </button>
      </div>
      {!localVoice && (
        <p className="tiny muted">
          No local English voice is available on this device.
        </p>
      )}
      {!enabled && (
        <p>
          Choose OpenAI in model settings to transcribe audio. You can continue
          typing with Ollama.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        {recording ? (
          <button className="button" onClick={stop}>
            Stop recording · {seconds}s
          </button>
        ) : (
          <button
            className="button secondary"
            disabled={!supported || !enabled || disabled || busy}
            onClick={() => void record()}
          >
            Record answer
          </button>
        )}
      </div>
      {!supported && (
        <p className="tiny muted">
          Recording needs a supported browser on HTTPS or localhost.
        </p>
      )}
      {preview && (
        <>
          <audio controls src={preview} />
          <div className="actions">
            <button
              className="button"
              disabled={busy || disabled || !enabled}
              onClick={() => void transcribe()}
            >
              Transcribe with OpenAI
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setBlob(null);
                setTranscript("");
              }}
            >
              Discard recording
            </button>
          </div>
        </>
      )}
      {busy && (
        <p role="status">
          {abort.current ? "Transcribing…" : "Opening microphone…"}{" "}
          {abort.current && (
            <button
              className="button secondary small"
              onClick={() => abort.current?.abort()}
            >
              Cancel transcription
            </button>
          )}
        </p>
      )}
      {transcript && (
        <>
          <label>
            Review transcript
            <textarea
              maxLength={6000}
              value={transcript}
              disabled={busy || disabled}
              onChange={(e) => setTranscript(e.target.value)}
            />
          </label>
          <button
            className="button secondary"
            disabled={disabled || busy || !transcript.trim()}
            onClick={() => {
              onTranscript(transcript);
              setTranscript("");
              setBlob(null);
            }}
          >
            Use transcript as answer
          </button>
          <p className="tiny muted">
            This replaces the current answer draft. Review it before pressing
            Send answer.
          </p>
        </>
      )}
    </details>
  );
}
