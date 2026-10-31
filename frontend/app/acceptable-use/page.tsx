import Link from "next/link";
import { PublicPage } from "../../components/public-page";
import { publicPageMetadata } from "../../lib/public-policies";

export const metadata = publicPageMetadata(
  "Acceptable Use Policy",
  "Acceptable use, prohibited content, and pre-generation NSFW content moderation rules for Greedy Motion."
);

export default function AcceptableUsePage() {
  return (
    <PublicPage
      title="Acceptable Use Policy"
      description="Prohibited content, safety rules, and automated NSFW & prompt moderation in Greedy Motion."
    >
      <section>
        <h2>Scope and purpose</h2>
        <p>
          Greedy Motion is a commercial motion-graphics and video authoring studio for creating product launch videos,
          feature walkthroughs, visual explainers, and short-form social stories for your own business, channels, or
          authorized clients. This Acceptable Use Policy applies to every account, brief, prompt, uploaded asset,
          storyboard, and rendered output on Greedy Motion.
        </p>
      </section>
      <section>
        <h2>Strictly prohibited content</h2>
        <p>You must not use Greedy Motion, or any output from the service, to generate, upload, or distribute:</p>
        <ul>
          <li>
            <strong>NSFW, sexual, or adult content:</strong> pornography, nudity, sexually explicit or sexually
            suggestive material of any kind, or any content that sexualizes, exploits, or endangers minors;
          </li>
          <li>
            <strong>Deepfakes and non-consensual likenesses:</strong> face swaps, face manipulation, or synthetic
            depictions of any real, identifiable person without their explicit authorization;
          </li>
          <li>
            <strong>Voice cloning or impersonation:</strong> imitations of a real person&apos;s voice (all voiceovers on
            Greedy Motion use only the licensed stock voices provided by the platform);
          </li>
          <li>
            <strong>Intellectual property infringement:</strong> another party&apos;s trademarks, logos, characters,
            music, or copyrighted material without permission, or videos that misrepresent affiliation or endorsement;
          </li>
          <li>
            <strong>Deceptive or fraudulent material:</strong> fake testimonials or reviews, fabricated financial or
            medical claims, phishing, political disinformation, or scams;
          </li>
          <li>
            <strong>Harassment, hate, or illegal acts:</strong> content promoting violence, self-harm, hate speech,
            threats, or unlawful activity.
          </li>
        </ul>
      </section>
      <section>
        <h2>How NSFW and prohibited content is filtered and blocked</h2>
        <p>
          Greedy Motion enforces multi-layer automated content moderation before any storyboard, scene, voiceover, or
          render job is executed:
        </p>
        <ul>
          <li>
            <strong>Pre-generation prompt moderation API screening:</strong> Every user-supplied brief, script prompt,
            scene edit, and revision instruction is screened upstream through our Content Moderation API (including
            Creem Content Moderation) before reaching any language, audio, or visual model. Both <code>deny</code> and{" "}
            <code>flag</code> moderation decisions are blocked immediately on a fail-closed basis.
          </li>
          <li>
            <strong>No unrestricted text-to-video generation:</strong> Videos are assembled from structured motion
            templates, user-supplied product screenshots, brand kits, and stock voiceovers rather than unconstrained
            open-ended video generation.
          </li>
          <li>
            <strong>Provider safety filters:</strong> All underlying model integrations run with strict safety filters
            enabled for sexual, hateful, violent, and deceptive content.
          </li>
        </ul>
      </section>
      <section>
        <h2>Enforcement</h2>
        <p>
          Any prompt or upload that triggers our content moderation filters is automatically rejected prior to
          execution. Repeated or deliberate attempts to bypass safety filters will result in immediate project removal
          and permanent account suspension without refund of consumed tokens. To report a violation or misuse, please
          contact us via our <Link href="/contact">contact page</Link> or email{" "}
          <a href="mailto:support@greedymotion.com">support@greedymotion.com</a>.
        </p>
      </section>
    </PublicPage>
  );
}
