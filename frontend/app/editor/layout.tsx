import type { Metadata } from "next";
import "../editor.css";

export const metadata: Metadata = {
  title: "Pro editor · Greedy Motion",
  description: "Timeline, canvas and inspector for Greedy Motion projects.",
  robots: { index: false, follow: false }
};

export default function EditorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
