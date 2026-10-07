import type { Metadata } from "next";
import { businessProfile } from "./business-profile";

export function publicPageMetadata(title: string, description: string): Metadata {
  return {
    title: `${title} — Greedy Motion`, description,
    robots: businessProfile.publicationStatus === "draft" ? { index: false, follow: false } : { index: true, follow: true },
  };
}
