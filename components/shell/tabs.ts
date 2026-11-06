export type TabId =
  | "overview"
  | "experience"
  | "applications"
  | "practice"
  | "study"
  | "tasks";

// Order is the sidebar order. Icons are 24px stroke paths, shown alone when the
// sidebar is collapsed.
export const tabs: {
  id: TabId;
  label: string;
  icon: string;
  title: string;
  subtitle: string;
}[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    title: "Make your next move count.",
    subtitle:
      "A focused workspace for the search, the practice, and the work ahead.",
  },
  {
    id: "experience",
    label: "Experience",
    icon: "M4 8h16v11H4zM9 8V5h6v3",
    title: "Your evidence, in your words.",
    subtitle:
      "Record only experience you can explain and defend in an interview.",
  },
  {
    id: "applications",
    label: "Applications",
    icon: "M5 5h14v4H5zM5 11h14v4H5zM5 17h9",
    title: "Your application pipeline.",
    subtitle:
      "Track opportunities and prepare against what the role actually requires.",
  },
  {
    id: "practice",
    label: "Interview practice",
    icon: "M4 5h16v10H9l-5 4z",
    title: "Practice with purpose.",
    subtitle: "One question at a time. Say it aloud, then refine your answer.",
  },
  {
    id: "study",
    label: "Study plan",
    icon: "M5 4h10l4 4v12H5zM9 12h6M9 16h6",
    title: "Four weeks. Steady progress.",
    subtitle:
      "10–15 hours a week, with something concrete to show for each one.",
  },
  {
    id: "tasks",
    label: "Preparation tasks",
    icon: "M4 12l5 5L20 6",
    title: "Turn insight into action.",
    subtitle: "The activities in your preparation plans, week by week.",
  },
];

export const tabById = (id: TabId) => tabs.find((t) => t.id === id)!;
