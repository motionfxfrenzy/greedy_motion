import Link from "next/link";
import { PublicPage } from "../../components/public-page";
import { businessProfile } from "../../lib/business-profile";
import { publicPageMetadata } from "../../lib/public-policies";

export const metadata = publicPageMetadata("Contact", "Contact Greedy Motion about your account, product questions, billing or privacy.");
export default function ContactPage() {
  return <PublicPage title="Contact us" description="Product questions, account help and requests about your data.">
    <section><h2>Customer support</h2>{businessProfile.supportEmail ? <p>Email <a href={`mailto:${businessProfile.supportEmail}`}>{businessProfile.supportEmail}</a>.</p> : <p>A verified customer support address must be supplied before this page is published.</p>}<p>Include the email address associated with your account, a short description of the issue, and a project or order reference where relevant. For render problems, include the error message and the approximate time it happened.</p><p>Do not send passwords, authentication codes, API keys or full payment-card details. Redact confidential information from screenshots attached to support requests.</p></section>
    <section><h2>Billing and cancellation</h2><p>Read the <Link href="/refunds">refund and cancellation policy</Link> before purchasing. If you have a billing question, include your order reference and purchase date, but not your card details.</p></section>
    <section><h2>Privacy and account requests</h2><p>Use the same support address to request access, correction or deletion of your personal data, or to report a privacy concern. Include the account email and describe the request. We may need to verify ownership before disclosing or changing account information.</p></section>
  </PublicPage>;
}
