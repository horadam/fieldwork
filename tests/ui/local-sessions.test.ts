// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  localSessionsKey,
  readLocalSessions,
  writeLocalSessions,
} from "../../lib/practice-session";

afterEach(() => localStorage.clear());

it("keeps browser-mode attempts apart per owner scope", () => {
  writeLocalSessions("browser", [{ planId: "a" }]);
  writeLocalSessions("someone@example.test", [{ planId: "b" }]);
  expect(readLocalSessions("browser")).toEqual([{ planId: "a" }]);
  expect(readLocalSessions("someone@example.test")).toEqual([{ planId: "b" }]);
});

it("moves unscoped attempts to the browser scope once", () => {
  localStorage.setItem("fieldwork-interviews-v1", '[{"planId":"old"}]');
  // Another owner never inherits them.
  expect(readLocalSessions("someone@example.test")).toEqual([]);
  expect(readLocalSessions("browser")).toEqual([{ planId: "old" }]);
  expect(localStorage.getItem("fieldwork-interviews-v1")).toBeNull();
  expect(localStorage.getItem(localSessionsKey("browser"))).toBe(
    '[{"planId":"old"}]',
  );
});
