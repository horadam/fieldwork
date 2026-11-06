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
      prompt="Question"
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
        prompt="Question"
      />,
    );
  fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
  await screen.findByRole("button", { name: /Stop recording/ });
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
      prompt="Question"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "type your answer",
  );
});
