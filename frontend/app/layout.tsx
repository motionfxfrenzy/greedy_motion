import type { Metadata } from "next";
import { themeBootScript } from "../components/theme-toggle";
import "./theme.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "Greedy Motion — Product video studio",
  description: "Turn approved product updates into customer-ready motion videos.",
  applicationName: "Greedy Motion",
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
