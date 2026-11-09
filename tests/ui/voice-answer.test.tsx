// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { VoiceAnswer } from "../../components/preparation/voice-answer";
import { ReadAloud } from "../../components/preparation/read-aloud";
import type { Request } from "../../lib/api-client";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("never requests microphone permission automatically and stays off for Ollama", () => {
  const request = vi.fn();
  render(
    <VoiceAnswer
      request={request as Request}
      enabled={false}
      disabled={false}
      onTranscript={() => {}}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "Record answer" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(request).not.toHaveBeenCalled();
});
it("stops microphone tracks on unmount without uploading", async () => {
  const stop = vi.fn(),
    media = { getTracks: () => [{ stop }] };
  const getUserMedia = vi.fn(async () => media);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    onstop: (() => void) | null = null;
    ondataavailable: ((e: unknown) => void) | null = null;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  const request = vi.fn(),
    view = render(
      <VoiceAnswer
        request={request as Request}
        enabled
        disabled={false}
        onTranscript={() => {}}
      />,
    );
  fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
  await screen.findByRole("button", { name: /Stop and transcribe/ });
  view.unmount();
  expect(stop).toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
it("handles denied microphone access with a typed-answer fallback", async () => {
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: vi.fn(async () => {
        throw new Error("denied");
      }),
    },
    configurable: true,
  });
  vi.stubGlobal("MediaRecorder", class {});
  render(
    <VoiceAnswer
      request={vi.fn() as Request}
      enabled
      disabled={false}
      onTranscript={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "type your answer",
  );
});
it("shows recording errors as a notice", async () => {
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: vi.fn(async () => {
        throw new Error("denied");
      }),
    },
    configurable: true,
  });
  vi.stubGlobal("MediaRecorder", class {});
  render(
    <VoiceAnswer
      request={vi.fn() as Request}
      enabled
      disabled={false}
      onTranscript={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
  expect((await screen.findByRole("alert")).className).toContain(
    "notice error",
  );
});
it("explains why recording is off without OpenAI", () => {
  render(
    <VoiceAnswer
      request={vi.fn() as Request}
      enabled={false}
      disabled={false}
      onTranscript={() => {}}
    />,
  );
  expect(screen.getByText(/need OpenAI|supported browser/)).toBeTruthy();
});
it("toggles one read-aloud button and hides it without a local voice", () => {
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      voice = null;
      onend = null;
      onerror = null;
    },
  );
  const synth = {
    voices: [{ localService: true, lang: "en-US" }] as unknown[],
    getVoices() {
      return this.voices;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    speak: vi.fn(),
    cancel: vi.fn(),
  };
  vi.stubGlobal("speechSynthesis", synth);
  const view = render(<ReadAloud text="Question" />);
  fireEvent.click(screen.getByRole("button", { name: "Read question aloud" }));
  expect(synth.speak).toHaveBeenCalledOnce();
  const button = screen.getByRole("button", { name: "Read question aloud" });
  expect(button.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button);
  expect(button.getAttribute("aria-pressed")).toBe("false");
  view.unmount();
  synth.voices = [];
  render(<ReadAloud text="Question" />);
  expect(screen.queryByRole("button", { name: /Read question/ })).toBe(null);
});
function stubRecorder() {
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    configurable: true,
  });
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    onstop: (() => void) | null = null;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["audio"]) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
}
it("transcribes once when recording stops and adds it to the draft", async () => {
  stubRecorder();
  const request = vi.fn(async () => ({ text: "I led the rollout." }));
  const onTranscript = vi.fn();
  render(
    <VoiceAnswer
      request={request as unknown as Request}
      enabled
      disabled={false}
      onTranscript={onTranscript}
    />,
  );
  // What will be sent, and its cost, is shown before recording starts.
  screen.getByText("Voice: sent to OpenAI when you stop");
  const mic = screen.getByRole("button", { name: "Record answer" });
  mic.focus();
  fireEvent.click(mic);
  // The same button becomes Stop, so keyboard focus stays on it.
  await screen.findByRole("button", { name: /Stop and transcribe/ });
  expect(document.activeElement).toBe(mic);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(mic);
  await waitFor(() =>
    expect(onTranscript).toHaveBeenCalledWith("I led the rollout."),
  );
  expect(request).toHaveBeenCalledOnce();
  screen.getByText(/Review it before sending/);
  screen.getByRole("button", { name: "Record answer" });
});
it("keeps a failed recording for an explicit retry, never retrying itself", async () => {
  stubRecorder();
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("OpenAI did not answer"))
    .mockResolvedValueOnce({ text: "Second try." });
  const onTranscript = vi.fn();
  render(
    <VoiceAnswer
      request={request as unknown as Request}
      enabled
      disabled={false}
      onTranscript={onTranscript}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Stop and transcribe/ }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "OpenAI did not answer",
  );
  expect(request).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: /Retry transcription/ }));
  await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("Second try."));
  expect(request).toHaveBeenCalledTimes(2);
});
