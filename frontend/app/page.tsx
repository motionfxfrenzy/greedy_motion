import type { Metadata } from "next";
import { LandingPage } from "../components/landing-page";

export const metadata: Metadata = {
  title: "Greedy Motion · Product videos, visual explainers & social stories",
  description:
    "Turn your brief, screenshots, and brand into on-brand motion videos, visual explainers, and 9:16 social stories. Review a storyboard, ask for changes, approve, download.",
  openGraph: {
    title: "Greedy Motion · Product videos, visual explainers & social stories",
    description:
      "Turn your brief, screenshots, and brand into on-brand motion videos, visual explainers, and 9:16 social stories. Review a storyboard, ask for changes, approve, download.",
    type: "website"
  }
};

export default function Home() {
  return <LandingPage />;
}
