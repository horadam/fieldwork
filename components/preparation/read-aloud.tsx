"use client";
import { useEffect, useRef, useState } from "react";

// Reads text with a device voice marked local, so no audio leaves the device.
// Renders nothing when no local English voice is available.
export function ReadAloud({ text }: { text: string }) {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null),
    [speaking, setSpeaking] = useState(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (typeof speechSynthesis === "undefined") return;
    const load = () =>
      setVoice(
        speechSynthesis
          .getVoices()
          .find((v) => v.localService && v.lang.startsWith("en")) || null,
      );
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      alive.current = false;
      speechSynthesis.cancel();
      speechSynthesis.removeEventListener("voiceschanged", load);
    };
  }, []);
  // A new question replaces the old one; stop reading the old one.
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    setSpeaking(false);
  }, [text]);
  if (!voice) return null;
  function toggle() {
    speechSynthesis.cancel();
    if (speaking) {
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.onend = utterance.onerror = () => {
      if (alive.current) setSpeaking(false);
    };
    setSpeaking(true);
    speechSynthesis.speak(utterance);
  }
  return (
    <button
      type="button"
      className="chat-icon"
      // A fixed name with aria-pressed: "Read question aloud, pressed".
      aria-label="Read question aloud"
      title={speaking ? "Stop reading" : "Read aloud with this device's voice"}
      aria-pressed={speaking}
      onClick={toggle}
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 5 6 9H2v6h4l5 4V5Z" />
        {speaking ? (
          <path d="m22 9-6 6m0-6 6 6" />
        ) : (
          <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
        )}
      </svg>
    </button>
  );
}
