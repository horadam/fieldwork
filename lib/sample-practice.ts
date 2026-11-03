// Sample general-practice content, shown when no preparation target is
// selected. Replace it with your own; nothing here is generated or derived from
// the experience bank.
export const interviewQuestions = [
  {
    question: "Tell me about yourself and why this role interests you.",
    guidance:
      "60–90 seconds: your background → the work most relevant to this role → why this role now. Keep company-specific motivation truthful.",
  },
  {
    question: "Walk me through a product or feature you helped ship.",
    guidance:
      "User problem, your exact contribution, key decisions, and the observed outcome. Separate your work from the team's.",
  },
  {
    question:
      "Which technical decision did you personally influence, and what alternative did you consider?",
    guidance:
      "Pick one actual decision. Explain constraints, your recommendation, the alternative, who decided, and what happened. Do not substitute a hypothetical design for past experience.",
  },
  {
    question: "How did you know your work made things better?",
    guidance:
      "Define the metric, baseline, period, sample, and your contribution. Explain what was observed versus causally established, and qualify any number you cannot substantiate.",
  },
  {
    question: "Describe a feature you delivered across frontend and backend.",
    guidance:
      "Choose one actual feature. Trace user interaction → state → API → data → release and support. Explain your responsibility and one failure mode.",
  },
  {
    question: "How do you handle ambiguous requirements?",
    guidance:
      "Use a real example: clarify the user outcome, test a risky assumption, ship a small slice, and use feedback. Include a concrete decision.",
  },
  {
    question: "How comfortable are you with the tools in this stack?",
    guidance:
      "Lead with your strongest matching skills. Name the gaps honestly as refresh areas, and explain the transferable concepts and what you are practicing now.",
  },
  {
    question: "What experience demonstrates speed, ownership, and judgment?",
    guidance:
      "Describe the actual context, pace, scope, and impact. Do not invent metrics or overstate the size of your role.",
  },
];
export const weeks = [
  {
    title: "Foundations & first interview",
    dates: "General roadmap",
    outcome: "Explain the stack and complete application CRUD.",
    items: [
      "2.5h · Interview preparation session",
      "1h · Next.js server/client boundaries",
      "1h · Supabase auth and row-level security",
      "2h · Application and experience CRUD",
      "2h · Demo exploration and deployment setup",
      "1h · TypeScript baseline without AI",
      "0.5h · Real end-to-end delivery story",
      "1h · Architecture decisions and gap log",
      "1h · Reproduce one core feature yourself",
    ],
  },
  {
    title: "Product UX & grounded analysis",
    dates: "General roadmap",
    outcome: "Trace a requirement back to verified evidence.",
    items: [
      "2h · Accessible forms and mobile states",
      "2h · Agent tools and evidence validation",
      "2h · Analysis UX and review",
      "1h · React async search exercise",
      "1h · SQL latest-analysis query",
      "1h · SaaS system-design practice",
      "1h · Two experience stories",
      "2h · Targeted reading and decision record",
    ],
  },
  {
    title: "Evaluations & reliability",
    dates: "General roadmap",
    outcome: "Measure a real prompt improvement.",
    items: [
      "2h · Execution limits and idempotency",
      "2h · Run and review 20-case live baseline",
      "2h · Change one variable and compare",
      "1h · Concurrent approval exercise",
      "1h · Ownership and SQL constraints",
      "1h · AI system-design mock",
      "1h · Metric story and caveats",
      "2h · Docs and failure analysis",
    ],
  },
  {
    title: "Portfolio & interview readiness",
    dates: "General roadmap",
    outcome: "Demo, case study, and two completed mocks.",
    items: [
      "2h · Reliability and two-user auth test",
      "2h · Deployment and walkthrough",
      "2h · Architecture and case study",
      "1h · Full mock A and review",
      "1h · Full mock B and review",
      "1h · Repeat weakest coding/design topic",
      "1h · Six story rehearsals",
      "2h · Targeted gap review",
    ],
  },
];

// Overview "next steps" and the general prep agenda, part of the same sample.
export const overviewSteps = [
  {
    title: "Own your story",
    detail:
      "Clarify your contribution, one tradeoff, and evidence of the outcome.",
    target: "practice",
  },
  {
    title: "Know your gaps",
    detail: "List the job requirements you cannot yet back with evidence.",
    target: "study",
  },
  {
    title: "Build something useful",
    detail: "Turn a real job description into a grounded preparation workflow.",
    target: "applications",
  },
] as const;
export const prepAgenda = [
  ["20 min", "Introduction and motivation"],
  ["45 min", "Two real project stories"],
  ["30 min", "Eight likely questions"],
  ["20 min", "Stack and evaluation refresh"],
  ["25 min", "Mock interview and retry"],
  ["10 min", "Your questions and logistics"],
] as const;
export const agendaMinutes = 150;
