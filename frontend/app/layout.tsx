import type { Metadata } from "next";
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
