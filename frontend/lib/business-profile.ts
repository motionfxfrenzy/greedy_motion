/** Owner-supplied facts are required before these pages can be published. */
export const businessProfile = {
  productName: "Greedy Motion",
  website: "https://www.greedymotion.com",
  operatorName: "Ramolabs" as string | null,
  operatorCountry: "Pakistan" as string | null,
  supportEmail: "support@greedymotion.com" as string | null,
  publicationStatus: "published" as "draft" | "published",
  billingDescription: "Greedy Motion is available as an early MVP. Paid purchasing is not currently offered on this website. When available, generation will be priced by output-video duration, not rendering time. The rate, duration increments, total price, taxes and any separately charged revisions or premium generation will be shown before purchase. No unlimited usage, free trial, automatic renewal or specific launch date is promised. Creating an account does not authorize a charge.",
  refundDescription: "When paid purchasing becomes available, you may request a refund of an unused prepaid balance within 30 calendar days of its purchase. Successfully delivered generation is normally non-refundable for a change of mind. Failed or undelivered generation will not consume paid usage; contact support if a charge was deducted incorrectly. For defective or materially misdescribed services, contact support for correction, re-performance or a refund as appropriate, without limiting mandatory legal remedies. Refund requests go to support@greedymotion.com with your purchase reference. Any merchant-of-record refund rights also apply.",
  cancellationDescription: "There is currently no paid subscription to cancel. Future recurring offers, if introduced, must disclose renewal and cancellation terms before purchase. You may ask support to cancel any future renewal; a request received before the renewal date prevents the next charge. Unless refunded, access continues through the period already paid for. Unused prepaid balances are handled under the refund policy. There are no routine prorated refunds for used service except where required by law. Account-closure requests will also stop any future recurring billing.",
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
