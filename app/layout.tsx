import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Fieldwork · Job Search Workspace",
  description:
    "Prepare with evidence. Track applications, practice interviews, and build a focused study plan.",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
