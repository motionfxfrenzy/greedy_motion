/** Owner-supplied facts are required before these pages can be published. */
export const businessProfile = {
  productName: "Greedy Motion",
  website: "https://www.greedymotion.com",
  operatorName: "Ramolabs" as string | null,
  operatorCountry: "Pakistan" as string | null,
  supportEmail: "support@greedymotion.com" as string | null,
  publicationStatus: "published" as "draft" | "published",
  billingDescription: "Greedy Motion is sold as monthly or yearly subscriptions (Starter, Pro and Advanced) billed in advance in US dollars, or in your local currency where shown at checkout, plus any applicable taxes. Each plan starts with a 7-day free trial; a payment method is required to start the trial, you are not charged until the trial ends, and the plan then renews automatically each month or year at the price shown at checkout until you cancel. Cancel before the trial ends and you are not charged. The price, currency, billing interval, taxes and renewal terms are shown before you confirm. Orders are processed by our merchant of record, Paddle. Creating an account alone does not authorize a charge.",
  refundDescription: "You may request a refund of a subscription charge or unused prepaid balance within 30 calendar days of the charge. Successfully delivered generation is normally non-refundable for a change of mind. Failed or undelivered generation will not consume paid usage; contact support if a charge was deducted incorrectly. For defective or materially misdescribed services, contact support for correction, re-performance or a refund as appropriate, without limiting mandatory legal remedies. Refund requests go to support@greedymotion.com with your purchase reference. Paddle, as merchant of record, issues approved refunds, and Paddle's buyer terms and any rights they give you also apply.",
  cancellationDescription: "You can cancel a subscription at any time by emailing support@greedymotion.com; the Manage billing link on your profile page also cancels it where shown. If you cancel during the 7-day free trial, you are not charged. If you cancel after the trial, your plan stays active until the end of the period you have paid for and does not renew; a request received before the renewal date prevents the next charge. There are no routine prorated refunds for used service except where required by law. Account-closure requests also stop any future recurring billing.",
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
