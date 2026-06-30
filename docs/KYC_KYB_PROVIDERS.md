# KYC / KYB Providers

**Geographic focus:** Zambia, Kenya, Ghana, and Eastern Africa (Uganda, Tanzania, Rwanda, Ethiopia).

> **Note:** Smile Identity and Smile ID are the same company (rebranded). Nuban is a bank account number validator already used in this project — not a KYC/KYB provider.

---

## 1. Recommended Provider

| Priority | Provider | Rationale |
|---|---|---|
| **Primary** | **Smile ID** | Strongest coverage across all target markets — Kenya, Ghana, Zambia, Uganda, Tanzania, Rwanda. Deep local ID support per country with a single unified API. |
| **Supplement** | **Dojah** | Useful only if Nigerian users are also in scope. Avoid for the core Eastern/West Africa markets — coverage is immature there. |
| **Enterprise fallback** | **Sumsub** | Only if regulatory requirements demand global-grade compliance or you expand beyond Africa. Cost is hard to justify at early stage. |
| **Avoid** | VerifyMe | Nigeria-only. No presence in any of the target markets. |

**Recommended stack:**
- **KYC** (individual) → Smile ID (national ID, passport, liveness per country)
- **KYB** (merchants/businesses) → Smile ID business verification where available + manual CAC/registration doc review for markets not yet supported

---

## 2. Cost Estimate

### Smile ID — Primary
**Pricing page:** [usesmileid.com/pricing](https://usesmileid.com/pricing/) | **Docs:** [docs.usesmileid.com](https://docs.usesmileid.com/)

Smile ID does not publish per-check rates publicly — pricing is quote-based depending on volume, country, and check type. Contact their sales team for a custom quote.

| What to expect | Notes |
|---|---|
| Pricing model | Pay-as-you-go per successful check |
| Free tier | Sandbox only — no free production checks |
| Volume discounts | Yes — negotiated directly |
| Minimum commitment | Likely required at scale — confirm with sales |

---

### Dojah — Nigerian supplement
**Pricing page:** [dojah.io/pricing](https://dojah.io/pricing) | **Docs:** [docs.dojah.io](https://docs.dojah.io/)

| Plan | Per API Call | Best For |
|---|---|---|
| Starting Out | as low as **$0.06** | Testing / early onboarding |
| Optimizing | as low as **$0.04** | Growth / higher volume |

- No published monthly minimum — contact sales for commitment thresholds
- Free sandbox tier available for testing

---

### Sumsub — Enterprise fallback
**Pricing page:** [sumsub.com/pricing](https://sumsub.com/pricing/) | **Docs:** [docs.sumsub.com](https://docs.sumsub.com/)

| Plan | Per Check | Monthly Minimum | Includes |
|---|---|---|---|
| Basic | **$1.35** | $149 | ID verification, liveness, questionnaires |
| Compliance | **$1.85** | $299 | Everything in Basic + AML screening, ongoing monitoring, address verification |
| Enterprise | Custom | Custom | White label, SSO, reusable KYC, dedicated CSM |

- Only charges for **successful** verifications
- **14-day free trial** with 50 free checks
- Plans can be upgraded or downgraded anytime

---

### VerifyMe — Nigeria-only, not recommended for target markets
**Website:** [verifyme.ng](https://verifyme.ng/) | **Sign up:** [app.verifyme.ng](https://app.verifyme.ng/auth/signup)

No public pricing — contact sales via [verifyme.ng/about-us/contact](https://verifyme.ng/about-us/contact) or request a demo.

---

### Cost Comparison at Scale

| Volume / month | Smile ID | Dojah (NG only) | Sumsub |
|---|---|---|---|
| 500 checks | Contact sales | ~$20 – $30 | ~$149 (minimum) |
| 5,000 checks | Contact sales | ~$200 – $300 | ~$675 – $925 |
| 50,000 checks | Negotiate volume deal | ~$2,000 | Negotiate enterprise |

> Sumsub is the only provider with fully transparent public pricing. Smile ID and Dojah require direct contact for production rates.

---

## 3. Integration Complexity

| | Smile ID | Dojah | Sumsub |
|---|---|---|---|
| **Integration style** | REST API + SDK | REST API only | WebSDK + REST API |
| **Mobile SDK** | Yes (iOS, Android) | No | Yes (iOS, Android) |
| **Hosted verification flow** | No | No | Yes (iFrame/WebSDK) |
| **Webhook support** | Yes | Yes | Yes |
| **Sandbox environment** | Yes | Yes | Yes |
| **Documentation quality** | Good | Good | Excellent |
| **Estimated integration time** | 3 – 5 days | 1 – 3 days | 5 – 10 days |
| **Effort rating** | Medium | Low | High |

**Integration notes:**

- **Smile ID** — REST API for database checks (ID number lookups, AML). Provides a JS widget for selfie/liveness capture if needed, otherwise you can call their API directly from your backend for pure database verifications. Single API key works across all supported countries.
- **Dojah** — Pure API, fast to wire up, but only useful for Nigerian users in this project's context.
- **Sumsub** — Offloads the entire verification UI to their hosted iFrame. More compliant out of the box but adds friction and tighter coupling to their platform. Overkill unless there is a hard regulatory mandate.

---

## 4. Coverage Matrix

### Target Market ID Documents

| Country | ID Type | Smile ID | Dojah | Sumsub |
|---|---|---|---|---|
| **Kenya** | National ID | Yes | Partial | Yes |
| **Kenya** | KRA PIN (Tax ID) | Yes | No | No |
| **Kenya** | Passport | Yes | No | Yes |
| **Ghana** | Ghana Card (National ID) | Yes | Partial | Yes |
| **Ghana** | SSNIT (Social Security) | Yes | No | No |
| **Ghana** | Passport | Yes | No | Yes |
| **Ghana** | Voter's Card | Yes | No | No |
| **Zambia** | National Registration Card (NRC) | Yes | No | Yes |
| **Zambia** | Passport | Yes | No | Yes |
| **Uganda** | National ID | Yes | No | Yes |
| **Uganda** | Passport | Yes | No | Yes |
| **Tanzania** | National ID (NIDA) | Yes | No | Yes |
| **Tanzania** | Passport | Yes | No | Yes |
| **Rwanda** | National ID | Yes | No | Yes |
| **Ethiopia** | National ID | Limited | No | Yes |
| **Nigeria** | BVN / NIN / CAC | Yes | Yes | Limited |

### Verification Capabilities

| Capability | Smile ID | Dojah | Sumsub |
|---|---|---|---|
| Database lookup (ID number only) | Yes | Yes | No |
| Document OCR (image scan) | Yes | Yes | Yes |
| Liveness / selfie check | Yes (SmartSelfie) | Yes | Yes |
| Face match (selfie vs. ID photo) | Yes | Yes | Yes |
| Address verification | No | Yes (NG only) | No |
| AML / PEP screening | Yes | Yes | Yes |
| Ongoing AML monitoring | No | No | Yes |
| KYB (business verification) | Yes | Yes (NG only) | Yes |

### Geographic Coverage Summary

| Country | Smile ID | Dojah | Sumsub | VerifyMe |
|---|---|---|---|---|
| Kenya | **Yes** | Partial | Yes | No |
| Ghana | **Yes** | Partial | Yes | No |
| Zambia | **Yes** | No | Yes | No |
| Uganda | **Yes** | No | Yes | No |
| Tanzania | **Yes** | No | Yes | No |
| Rwanda | **Yes** | No | Yes | No |
| Ethiopia | Limited | No | Yes | No |
| Nigeria | **Yes** | **Yes** | Limited | **Yes** |
| South Africa | **Yes** | No | Yes | No |
| Global (200+ countries) | No | No | **Yes** | No |

**Coverage verdict:** Smile ID is the only shortlisted provider with meaningful coverage across all target markets under a single integration. Sumsub matches on geography but at 3–10x the cost per verification.
