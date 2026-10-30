/** Owner-supplied facts are required before these pages can be published. */
export const businessProfile = {
  productName: "Greedy Motion",
  website: "https://www.greedymotion.com",
  operatorName: "Ramolabs" as string | null,
  operatorCountry: "Pakistan" as string | null,
  supportEmail: "support@greedymotion.com" as string | null,
  publicationStatus: "published" as "draft" | "published",
  billingDescription: "Greedy Motion offers a Free tier (no credit card required) and paid monthly or annual subscriptions (Starter, Pro and Studio), as well as optional one-time token packs, billed in US dollars or in your local currency where shown at checkout, plus any applicable taxes. Paid subscriptions renew automatically each month or year at the price shown at checkout until you cancel. The price, currency, billing interval, taxes, included token allowance and renewal terms are shown before you confirm. Orders are processed by our authorized merchant of record (such as Polar or Paddle) identified at checkout. Creating an account alone does not authorize a charge.",
  refundDescription: "You may request a refund of an unused subscription charge or unused prepaid token pack within 30 calendar days of the charge. Completed renders delivered to your project are normally non-refundable for a change of mind. Failed or undelivered renders do not consume paid tokens; contact support if tokens or charges were deducted incorrectly. For defective or materially misdescribed services, contact support for correction, re-performance or a refund as appropriate, without limiting mandatory legal remedies. Refund requests go to support@greedymotion.com with your purchase reference. Approved refunds are issued through the merchant of record identified on your receipt, and its buyer terms and any mandatory consumer rights also apply.",
  cancellationDescription: "You can cancel a paid subscription at any time from the billing portal or by emailing support@greedymotion.com. When you cancel, your subscription stays active until the end of the billing period you have paid for and does not renew; a cancellation received before the renewal date prevents the next charge. Unused one-time token packs remain on your account. Account-closure requests also stop any future recurring billing.",
};

export function missingBusinessFacts(): string[] {
  return [
    ["operatorName", "Business operator name"],
    ["operatorCountry", "Business country"],
    ["supportEmail", "Customer support email"],
    ["billingDescription", "Billing and trial terms"],
    ["refundDescription", "Refund policy"],
    ["cancellationDescription", "Cancellation policy"],
  ].flatMap(([key, label]) => businessProfile[key as keyof typeof businessProfile] ? [] : [label]);
}
