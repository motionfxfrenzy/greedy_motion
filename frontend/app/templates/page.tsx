"use client";

import { Suspense } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { TemplatesPage } from "../../components/template-gallery";

/** /templates: the whole gallery. Choosing one opens its prefilled brief in Studio (the Studio page reads ?template=). */
export default function Templates() {
  const router = useRouter();
  // The page reads ?use= and ?q= (the open tab and the search), so it sits in a Suspense boundary.
  return <AppShell active="templates"><Suspense fallback={null}><TemplatesPage onUse={(item) => router.push(`/studio?template=${encodeURIComponent(item.id)}`)} /></Suspense></AppShell>;
}
