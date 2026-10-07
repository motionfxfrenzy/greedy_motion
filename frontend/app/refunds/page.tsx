import Link from "next/link";
import { PublicPage } from "../../components/public-page";
import { businessProfile } from "../../lib/business-profile";
import { publicPageMetadata } from "../../lib/public-policies";

export const metadata = publicPageMetadata("Refunds and cancellation", "Refund requests, renewal cancellation and billing support for Greedy Motion.");
export default function RefundsPage() {
  return <PublicPage title="Refunds & cancellation" description="Understand the billing rules before choosing a paid plan.">
    <section><h2>Availability of paid plans</h2><p>{businessProfile.billingDescription ?? "Paid plans and trial terms have not been confirmed for this draft. It does not offer checkout or authorize any charge."}</p></section>
    <section><h2>Refund eligibility</h2><p>{businessProfile.refundDescription ?? "The refund window, eligible purchases, usage conditions and treatment of renewal charges require owner confirmation before this policy is published."}</p><p>Mandatory rights for faulty, misdescribed or undelivered digital services apply where required by law. An optional commercial refund policy does not remove those rights.</p></section>
    <section><h2>Cancel a subscription</h2><p>{businessProfile.cancellationDescription ?? "Cancellation methods, renewal deadlines and the duration of access after cancellation require owner confirmation before subscriptions are sold."}</p><p>Signing out, uninstalling a browser or deleting a shortcut does not cancel a subscription. Cancellation and a refund request are separate actions; a cancellation request should state whether a refund is also requested.</p></section>
    <section><h2>Request help</h2><p>Use our <Link href="/contact">contact page</Link> and include the purchase email, order reference, date and reason for your request. Do not include payment-card details. Report duplicate charges, failed delivery or technical issues so they can be investigated.</p><p>If a purchase is processed by a merchant of record, that merchant will be identified at checkout and on the receipt. Its buyer terms and applicable law also govern the transaction. Approved refunds are returned through the original payment provider; posting times depend on that provider and your bank.</p></section>
  </PublicPage>;
}
