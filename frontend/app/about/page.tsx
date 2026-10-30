import Link from "next/link";
import { PublicPage } from "../../components/public-page";
import { businessProfile } from "../../lib/business-profile";
import { publicPageMetadata } from "../../lib/public-policies";

export const metadata = publicPageMetadata("About", "Motion video software for product launches, visual explainers, and short-form social stories.");
export default function AboutPage() {
  return <PublicPage title="About Greedy Motion" description="Turn your product or brand story into a motion video you can review and refine.">
    <section><h2>What we build</h2><p>Greedy Motion is browser-based motion-design software for creating product launch videos, feature walkthroughs, visual explainers and short-form social stories (16:9 and 9:16) from your brief, product screenshots, approved copy and brand kits. It is built for founders, marketers, creators and teams who need studio-grade motion graphics without a complex timeline maze.</p></section>
    <section><h2>How it works</h2><p>Users supply a structured brief and optional product screenshots, apply their brand kit (logos, colors and typography), and review a multi-scene storyboard. Assisted planning helps structure the script, motion choreography and stock voiceover. The Studio editor lets users adjust timing, layers, keyframes and copy, and timestamped comments capture scoped revisions before rendering.</p><p>Cloud motion rendering runs asynchronously. Completed MP4 renders are delivered digitally through the project, where users can review and download the output. There is no physical delivery. Availability, render time and output quality depend on the selected template style, supplied assets and rendering capacity.</p></section>
    <section><h2>Review before publishing</h2><p>Assisted script suggestions, layout proposals and rendered motion graphics should be reviewed before publication. Users should check every video for factual accuracy, brand consistency and rights to use the supplied material before sharing it. Illustrations and sample projects on this website demonstrate the workflow and do not represent customer endorsements.</p></section>
    <section><h2>Plans and availability</h2><p>{businessProfile.billingDescription ?? "Commercial plans, prices and launch availability are awaiting confirmation. This draft does not offer a paid subscription or promise a trial."}</p></section>
    <section><h2>Questions?</h2><p>See our <Link href="/contact">contact page</Link> for product and support enquiries, our <Link href="/terms">terms</Link> for use of the service, and our <Link href="/privacy">privacy notice</Link> for data handling.</p></section>
  </PublicPage>;
}
