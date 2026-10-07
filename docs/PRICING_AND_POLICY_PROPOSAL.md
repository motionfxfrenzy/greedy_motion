# Greedy Motion: launch pricing and policy proposal

Prepared 2026-10-07. Historical pricing proposal below; superseded by the owner-approved publication decision in this section.

## Publication decision — October 7, 2026

The owner authorized publishing and production deployment. Publish About, Contact, Privacy, Terms and Refunds/Cancellation with Ramolabs, Pakistan and support@greedymotion.com. Use per-output-minute billing, not the proposed subscription/video allowances below. No rate has been agreed and paid purchasing remains unavailable during coming soon. Do not advertise the historical $29/$59 plans or evaluation allowance.

Approved policy direction: unused prepaid balance refunds within 30 days; delivered generation normally non-refundable for change of mind; mandatory remedies and merchant-of-record rights preserved. Include a 12-month-fees liability cap with non-excludable-liability carve-outs, no performance guarantees and a narrow business-customer content indemnity. These terms have not undergone independent legal review and do not guarantee enforceability. Pricing, metering, checkout and operational launch require separate implementation and testing.

## Confirmed business information

- Greedy Motion by Ramolabs, Pakistan.
- Customer support: support@greedymotion.com (owner supplied; delivery has not been tested).
- Website: https://www.greedymotion.com.
- Confirm the operator name matches the merchant onboarding identity; do not invent a registration number or business address.

## Cost evidence and limits

Local measurements in `docs/SKILL_LIBRARY.md` put template fill at $0.03–$0.06 in model tokens plus render compute. Author mode costs $3–$8 in tokens and 20–45 minutes. `docs/MOTION_PIPELINE.md` estimates $1.25–$2.30 for a generative 3D shot, or $2.50–$4.60 for a two-shot ad, before the rest of the production pipeline.

These are samples, not fully loaded cost per delivered video. Audio, retries, revisions, fixed hosting, storage, egress, payment fees, refunds and support must be measured. `docs/STACK_DECISIONS.md` explicitly requires cost per accepted video, not vendor list prices alone. Do not claim a proven margin from these samples.

## Market check

Official pages checked 2026-10-07:

- [HeyGen](https://www.heygen.com/pricing): Creator $29/month, Pro $49/month. Avatar-centric and not directly equivalent to product motion graphics.
- [Revid](https://www.revid.ai/pricing): Growth currently promoted at $39/month with 2,000 credits; Ultra $199/month. Generative media consumes different amounts of credits.
- [Lemon Squeezy fees](https://docs.lemonsqueezy.com/help/getting-started/fees): base example uses 5% + $0.50, plus 0.5% subscriptions, 1.5% international and other applicable fees. Fees apply to total order value including tax; payout fees can also apply.

## Recommended launch offer

USD, monthly only initially. Do not enable paid checkout until entitlement enforcement and payment lifecycle tests pass.

| Plan | Monthly price | Included template production |
| --- | --- | --- |
| Starter | $29 | 10 videos, up to 60 seconds each |
| Pro | $59 | 30 videos, up to 60 seconds each |

Both plans are single-user initially; do not promise team seats. Include supported 1080p MP4 aspect ratios only after testing. Each video allocation covers an initial successful draft plus two successful AI revision renders. Re-downloading or exporting an unchanged saved result does not consume another allocation. Additional revisions must show a cost and require confirmation. Never charge quota for infrastructure failures; reserve quota atomically and restore it on failure.

Monthly allowances reset on renewal, do not roll over and have no cash value. No automatic overages; stop at the allowance and let the user explicitly upgrade. Defer annual billing and top-up packs until actual retention and costs are known. Custom author-mode compositions, Veo footage, image generation and other costly extras are excluded from these allowances and should remain unavailable or separately quoted, not silently included.

Recommended evaluation: two template preview renders total per verified account, no card, no automatic subscription. No 14-day unlimited trial. Enforce an abuse-resistant limit before advertising it. Preview watermarking is a proposed feature, not an existing claim.

### Sensitivity check, not a measured margin

Budget $0.50 per completed template-video allocation, including its allowed revisions, as an initial hypothesis. Reserve approximately 8% + $0.50 per subscription payment for processing/payout variability (not a provider quote and not sufficient for every tax/payment scenario).

| Plan at full allowance | Revenue | Variable video budget | Fee reserve | Remainder before fixed costs, support, refunds and tax |
| --- | --- | --- | --- | --- |
| Starter | $29 | $5 | $2.82 | $21.18 (73%) |
| Pro | $59 | $15 | $5.22 | $38.78 (66%) |

At $1 per video allocation those remainders fall to $16.18 (56%) and $23.78 (40%). At $4 author-mode cost, 30 videos alone would cost $120, making the $59 plan untenable. Measure at least a representative batch of full, revised, accepted projects before finalizing allowances; reduce allowances or increase pricing if the $0.50 budget fails. Low customer counts may not cover fixed hosting even if variable contribution is positive.

## Recommended commercial policies

All below require owner approval and operational support before publication. These are business recommendations, not jurisdiction-specific legal advice; have counsel review for relevant customer markets.

1. **Refunds:** full refund of the first subscription payment when requested within seven calendar days. Keep this simple and unconditional for the initial template-only offering. Renewals refundable within seven days if no paid generation was used in the new period. Duplicate/unauthorized charges, failure to supply the service and mandatory consumer remedies are handled separately; do not restrict statutory rights to these windows. A refunded period ends its paid entitlement.
2. **Cancellation:** cancel renewal at any time via a working billing portal or support email. Requests received before renewal must prevent the next charge even if staff process them later. Access continues through the paid period unless refunded. No routine prorated refunds outside the stated policy, subject to applicable rights. Account deletion and subscription cancellation are separate; deletion must not leave recurring billing active.
3. **Billing:** clearly disclose USD price, taxes, monthly renewal, allowance reset, excluded features and cancellation before checkout. No charges for creating an account; no silent trial conversion or overages. Identify the actual merchant of record at checkout and in the policy only when integration is live.
4. **Delivery:** digital access and downloadable MP4 files, not physical goods. Show asynchronous render progress and failures; do not promise instant delivery or guaranteed turnaround.
5. **Support:** support@greedymotion.com. Aim internally for two business days but do not publish a response-time guarantee until staffed and measured. Test inbound mail and replies.
6. **Content and acceptable use:** users need rights to uploaded screenshots, logos, fonts, voices and other assets. Prohibit illegal content, impersonation without permission, rights violations and abuse. Grant only the processing license needed to operate the service, not ownership of customer content. Avoid blanket copyright/exclusivity guarantees for AI output.
7. **Privacy:** accurately disclose authentication, project uploads, relevant AI inputs, storage/hosting providers and international processing. Do not claim zero retention, no training by providers, encryption guarantees or certifications without verification. Document current media-URL access limitations and fix them before promising private assets.
8. **Data rights and retention:** accept access, correction, export and deletion requests through support after identity verification. Do not promise a deletion SLA, automatic retention period or backup deletion deadline until implemented. Document actual retention and legal/accounting exceptions before launch. Obtain separate consent for marketing; do not bundle it with service acceptance.
9. **Changes and limitations:** notify users of material pricing/terms changes before they affect renewal. Preserve non-waivable consumer rights; do not invent governing-law clauses, arbitration or blanket liability waivers. Legal review is recommended before paid launch.

[Lemon Squeezy refund rules](https://docs.lemonsqueezy.com/help/payments/refunds-chargebacks) permit seller policies but reserve discretionary refunds within 60 days to prevent chargebacks. This is not a promise that Greedy Motion offers a 60-day money-back guarantee.

## Release gates and branch promotion

- Owner approves prices, allowances, evaluation offer and policies.
- Finalize public About, Contact, Privacy, Terms and Refunds/Cancellation pages; remove draft notices only after approval. Add working links from landing, authentication and checkout.
- Remove fictitious testimonials/customer logos and unconfirmed trial claims. Clearly label illustrative demos.
- Verify support inbox, legal operator details and any address required by the payment provider.
- Verify staging/production API connectivity, public signup, email delivery, user isolation and a real render/download. Documentation currently records production API/domain and worker readiness gaps; verify current deployment state rather than assume fixed.
- Implement and test billing webhooks, idempotency, quotas, failed-job refunds, cancellation, entitlement expiry and refunds before accepting money. Policy pages alone do not implement these mechanisms.
- Check public policy routes without login, mobile navigation, links, typecheck/build and accessible form links.
- Commit only task-owned files to main, push main, merge/push staging, verify its deployed commit and public flows, then merge/push production and smoke-test. Preserve existing production mobile/coming-soon behavior unless its replacement is explicitly approved and operational.
- Do not promote draft legal pages or advertise unavailable paid features solely to pass merchant review. Approval remains at Lemon Squeezy's discretion.
