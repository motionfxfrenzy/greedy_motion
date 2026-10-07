import Link from "next/link";
import { PublicPage } from "../../components/public-page";
import { businessProfile } from "../../lib/business-profile";
import { publicPageMetadata } from "../../lib/public-policies";

export const metadata = publicPageMetadata("About", "Product video software for founders, marketers and SaaS teams.");
export default function AboutPage() {
  return <PublicPage title="About Greedy Motion" description="Turn your product story into a video you can review and refine.">
    <section><h2>What we build</h2><p>Greedy Motion is browser-based software for creating product motion videos from screenshots, approved copy and brand assets. It is designed for founders, marketers and SaaS teams making product launches, feature demonstrations and release updates.</p></section>
    <section><h2>How it works</h2><p>Users supply a brief and their own product screenshots, choose brand styling, and review a storyboard. AI assists with story planning and supported audio features. The Studio editor lets users revise supported project values, and timestamped comments capture feedback before a new render.</p><p>Video generation runs asynchronously. Completed renders are delivered digitally through the project, where users can review and download the output. There is no physical delivery. Availability, generation time and output quality depend on the selected features, supplied assets and rendering capacity.</p></section>
    <section><h2>Review before publishing</h2><p>AI suggestions and generated media can contain mistakes. Users should check every video for factual accuracy, brand consistency and rights to use the supplied and generated material before sharing it. Illustrations and sample projects on this website demonstrate the workflow and do not represent customer endorsements.</p></section>
    <section><h2>Plans and availability</h2><p>{businessProfile.billingDescription ?? "Commercial plans, prices and launch availability are awaiting confirmation. This draft does not offer a paid subscription or promise a trial."}</p></section>
    <section><h2>Questions?</h2><p>See our <Link href="/contact">contact page</Link> for product and support enquiries, our <Link href="/terms">terms</Link> for use of the service, and our <Link href="/privacy">privacy notice</Link> for data handling.</p></section>
  </PublicPage>;
}
