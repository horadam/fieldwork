// How this deployment presents itself to visitors. Shared by server and
// browser; NEXT_PUBLIC_ values are built into the page.

// False on invite-only deployments (NEXT_PUBLIC_SIGNUPS=closed).
export const signupsOpen = () => process.env.NEXT_PUBLIC_SIGNUPS !== "closed";

// What to do when no model is available to this visitor.
export const accessHint = () =>
  signupsOpen()
    ? "Sign in, or add your own OpenAI key, to run AI steps here."
    : "Add your own OpenAI key in the model panel to run AI steps here, or use Simulated preview.";
