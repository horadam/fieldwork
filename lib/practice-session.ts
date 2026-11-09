import { z } from "zod";
import { callMetadataSchema, feedbackSchema } from "./feedback";
import {
  validateVersion,
  type PreparationPlanVersion,
} from "./preparation-plan";

const text = z.string().trim().min(1);
export { feedbackSchema };
export const turnSchema = z.object({
  id: z.string().uuid(),
  questionId: text.max(60),
  prompt: text.max(1000),
  answer: text.max(6000),
  feedback: feedbackSchema,
  metadata: callMetadataSchema,
});
export const sessionSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  createdAt: z.string().datetime(),
  revision: z.number().int().min(0).max(20),
  mode: z.enum(["coach", "interview"]),
  questionIds: z.array(text.max(60)).min(1).max(3),
  activityId: text.max(60).nullable(),
  turns: z.array(turnSchema).max(9),
  questionIndex: z.number().int().min(0).max(3),
  prompt: z.string().max(1000),
  status: z.enum(["active", "completed"]),
});
export type PracticeSession = z.infer<typeof sessionSchema>;
export function validateSession(raw: unknown, rawPlan: PreparationPlanVersion) {
  const plan = validateVersion(rawPlan),
    s = sessionSchema.parse(raw);
  if (
    s.planId !== plan.id ||
    new Set(s.questionIds).size !== s.questionIds.length ||
    s.questionIds.some((id) => !plan.output.questions.some((q) => q.id === id))
  )
    throw new Error("Select questions from this plan version.");
  if (
    s.activityId &&
    !plan.output.activities.some(
      (a) =>
        a.id === s.activityId &&
        s.questionIds.every((id) => a.questionIds.includes(id)),
    )
  )
    throw new Error("Activity does not contain these questions.");
  if (
    s.turns.some((t) => !s.questionIds.includes(t.questionId)) ||
    new Set(s.turns.map((t) => t.id)).size !== s.turns.length
  )
    throw new Error("Invalid practice turns.");
  let previousIndex = 0;
  if (s.turns.length && s.turns[0].questionId !== s.questionIds[0])
    throw new Error("Invalid first question.");
  for (const turn of s.turns) {
    const index = s.questionIds.indexOf(turn.questionId);
    if (index < previousIndex || index > previousIndex + 1)
      throw new Error("Invalid question order.");
    previousIndex = index;
  }
  if (
    s.questionIds.some(
      (id) => s.turns.filter((t) => t.questionId === id).length > 3,
    )
  )
    throw new Error("Follow-up limit reached.");
  if (
    s.status === "active" &&
    (s.questionIndex >= s.questionIds.length ||
      !s.prompt ||
      s.turns.filter((t) => t.questionId === s.questionIds[s.questionIndex])
        .length >= 3)
  )
    throw new Error("Invalid active question.");
  if (
    s.questionIndex > s.questionIds.length ||
    (s.turns.length && previousIndex > s.questionIndex)
  )
    throw new Error("Invalid session position.");
  if (JSON.stringify(s).length > 90000)
    throw new Error("Practice session is too large.");
  return s;
}
export function newSession(
  plan: PreparationPlanVersion,
  ids: string[],
  mode: PracticeSession["mode"],
  activityId: string | null = null,
): PracticeSession {
  return validateSession(
    {
      id: crypto.randomUUID(),
      planId: plan.id,
      createdAt: new Date().toISOString(),
      revision: 0,
      mode,
      questionIds: ids,
      activityId,
      turns: [],
      questionIndex: 0,
      prompt: plan.output.questions.find((q) => q.id === ids[0])?.text,
      status: "active",
    },
    plan,
  );
}
export function advanceSession(
  plan: PreparationPlanVersion,
  session: PracticeSession,
  turn: z.infer<typeof turnSchema>,
  followUp: string | null,
): PracticeSession {
  const s = validateSession(session, plan);
  if (s.status !== "active") throw new Error("This session has ended.");
  const questionId = s.questionIds[s.questionIndex];
  if (turn.questionId !== questionId || turn.prompt !== s.prompt)
    throw new Error("Question changed.");
  const turns = [...s.turns, turnSchema.parse(turn)];
  const canFollow = turns.filter((t) => t.questionId === questionId).length < 3;
  const index = followUp && canFollow ? s.questionIndex : s.questionIndex + 1;
  return validateSession(
    {
      ...s,
      revision: s.revision + 1,
      turns,
      questionIndex: index,
      status: index >= s.questionIds.length ? "completed" : "active",
      prompt:
        index >= s.questionIds.length
          ? ""
          : index === s.questionIndex
            ? followUp
            : plan.output.questions.find((q) => q.id === s.questionIds[index])!
                .text,
    },
    plan,
  );
}
export function saveLocalSession(
  sessions: PracticeSession[],
  next: PracticeSession,
) {
  const old = sessions.find((s) => s.id === next.id);
  if (old && JSON.stringify(old) === JSON.stringify(next)) return sessions;
  if (
    old &&
    (old.status === "completed" ||
      old.planId !== next.planId ||
      JSON.stringify(old.questionIds) !== JSON.stringify(next.questionIds) ||
      old.mode !== next.mode ||
      old.activityId !== next.activityId ||
      next.turns.length < old.turns.length ||
      old.turns.some(
        (t, i) => JSON.stringify(t) !== JSON.stringify(next.turns[i]),
      ))
  )
    throw new Error("Saved history cannot change.");
  if (old ? next.revision !== old.revision + 1 : next.revision !== 0)
    throw new Error(
      "Session changed in another tab. Reload before continuing.",
    );
  if (!old && sessions.length >= 100)
    throw new Error(
      "This browser has 100 practice sessions. Delete an unneeded preparation plan to remove its attempts before adding more.",
    );
  return [...sessions.filter((s) => s.id !== next.id), next];
}
