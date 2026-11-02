"use client";
import { useEffect, useState } from "react";

type Notes = {
  answers: Record<number, string>;
  study: Record<string, boolean>;
  scores: Record<string, string>;
};
const blank: Notes = { answers: {}, study: {}, scores: {} };

// General practice notes autosave in this browser, kept apart per account so
// signing in never shows another person's notes.
export function usePracticeNotes(owner: string) {
  const key = `fieldwork-practice-${owner}`;
  const [notes, setNotes] = useState<Notes & { key: string | null }>({
    ...blank,
    key: null,
  });
  useEffect(() => {
    let saved: Partial<Notes> = {};
    try {
      saved = JSON.parse(localStorage.getItem(key) || "{}");
    } catch {
      /* Start blank when saved notes are unreadable. */
    }
    setNotes({ ...blank, ...saved, key });
  }, [key]);
  useEffect(() => {
    // Only write notes loaded for this owner, never a previous owner's.
    if (notes.key !== key) return;
    try {
      const { answers, study, scores } = notes;
      localStorage.setItem(key, JSON.stringify({ answers, study, scores }));
    } catch {
      /* Workspace operations remain usable if practice persistence is unavailable. */
    }
  }, [notes, key]);
  const change =
    <K extends keyof Notes>(field: K) =>
    (value: Notes[K]) =>
      setNotes((old) => ({ ...old, [field]: value }));
  return {
    answers: notes.answers,
    study: notes.study,
    scores: notes.scores,
    setAnswers: change("answers"),
    setStudy: change("study"),
    setScores: change("scores"),
  };
}
