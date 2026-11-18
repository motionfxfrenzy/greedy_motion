import type { Metadata } from "next";
import { themeBootScript } from "../lib/site-theme";
import "./theme.css";
import "./styles.css";
import "./animation-workspace.css";
import "./plate-preview.css";

export const metadata: Metadata = {
  title: "Greedy Motion · Motion graphics with code",
  description: "Motion graphics with code: turn a plain-language brief into customer-ready motion videos. Greedy Motion writes the animation code for you, so every frame is code and every change is precise.",
  keywords: ["motion graphics with code", "motion with code", "animate with code", "code-powered animation", "product video", "motion graphics", "product launch video"],
  applicationName: "Greedy Motion",
  openGraph: {
    title: "Greedy Motion · Motion graphics with code",
    description: "Turn a plain-language brief into customer-ready motion videos. Every frame is code, so every change is precise.",
    siteName: "Greedy Motion",
    type: "website"
  },
  twitter: {
    card: "summary",
    title: "Greedy Motion · Motion graphics with code",
    description: "Turn a plain-language brief into customer-ready motion videos. Every frame is code, so every change is precise."
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"]
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
