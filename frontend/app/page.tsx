import type { Metadata } from "next";
import { LandingPage } from "../components/landing-page";

export const metadata: Metadata = {
  title: "Greedy Motion — Product videos, without the production maze",
  description:
    "Turn approved screenshots and product messaging into on-brand motion videos. Review a storyboard, ask for changes, approve, download.",
  openGraph: {
    title: "Greedy Motion — Product videos, without the production maze",
    description:
      "Turn approved screenshots and product messaging into on-brand motion videos. Review a storyboard, ask for changes, approve, download.",
    type: "website"
  }
};

export default function Home() {
  return <LandingPage />;
}
