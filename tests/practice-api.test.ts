import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { target, version, workspace } from "./preparation-fixtures";
import { planSources } from "../lib/preparation-plan";
import { newSession } from "../lib/practice-session";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  reserve: vi.fn(),
  owned: vi.fn(),
  turn: vi.fn(),
}));
vi.mock("../lib/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/server")>()),
  inferenceAccess: mocks.access,
  reserveInference: mocks.reserve,
}));
vi.mock("../lib/practice-server", () => ({ ownedPracticePlan: mocks.owned }));
vi.mock("../lib/practice-generation", () => ({ practiceTurn: mocks.turn }));
import { POST } from "../app/api/practice/turn/route";
const request = (body: unknown) =>
  new NextRequest("http://127.0.0.1:3000/api/practice/turn", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(null);
});
describe("practice API", () => {
  it("validates local source/attempt IDs before inference", async () => {
    const plan = version(await planSources(target, workspace())),
      session = newSession(plan, ["q1"], "coach");
    const response = await POST(
      request({
        planId: plan.id,
        sessionId: crypto.randomUUID(),
        revision: 0,
        answer: "Answer",
        plan,
        session,
      }),
    );
    expect(response.status).toBe(409);
    expect(mocks.turn).not.toHaveBeenCalled();
  });
  it("loads owned account sources instead of accepting browser snapshots", async () => {
    const plan = version(await planSources(target, workspace())),
      session = newSession(plan, ["q1"], "coach");
    const single = vi.fn(async () => ({ data: { payload: session } }));
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single,
    };
    mocks.access.mockResolvedValue({ db: { from: () => query } });
    mocks.owned.mockResolvedValue(plan);
    mocks.turn.mockResolvedValue({ session });
    const response = await POST(
      request({
        planId: plan.id,
        sessionId: session.id,
        revision: 0,
        answer: "Answer",
        plan: "forged",
        session: "forged",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.turn.mock.calls[0][0]).toEqual(plan);
    expect(mocks.reserve).toHaveBeenCalled();
  });
  it("does not infer when access is denied", async () => {
    mocks.access.mockRejectedValue(new Error("denied"));
    await POST(request({}));
    expect(mocks.turn).not.toHaveBeenCalled();
  });
});
