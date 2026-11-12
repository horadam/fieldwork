import type { Feedback } from "@/lib/feedback";
import { usageParts, type CallRecord } from "@/lib/pricing";
import { Meta } from "../ui/meta";

// AI coach feedback: labelled points, then what the call used. The model's
// answerQuote is only checked against the user's text, never shown. Shared
// by mock-interview turns and notes reviews.
export function CoachFeedback({
  feedback,
  metadata,
}: {
  feedback: Feedback;
  metadata: CallRecord & { model: string };
}) {
  return (
    <>
      <dl className="feedback-points">
        <dt>Strength</dt>
        <dd>{feedback.strength}</dd>
        <dt>Try next</dt>
        <dd>{feedback.improvement}</dd>
        {feedback.caution && (
          <>
            <dt>Check</dt>
            <dd>{feedback.caution}</dd>
          </>
        )}
      </dl>
      <Meta items={[metadata.model, ...usageParts(metadata)]} />
    </>
  );
}
