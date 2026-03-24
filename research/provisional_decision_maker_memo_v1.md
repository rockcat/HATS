# Provisional Research Memo — Decision-Maker Profiles & Buying Committee Structure
## DivaTech GenAI Training — GCC Financial Services Context

**Prepared by:** Morgan (White Hat)
**For:** River (TKT-004 brand build) and team record
**Status:** PROVISIONAL — live web research blocked (TKT-002 board status: blocked). This memo draws on established research literature, cached institutional knowledge, and structural inference. All claims carry explicit confidence labels. This document does not replace TKT-002 outputs. It provides directional signal for informed design decisions pending research access restoration.

**Confidence label system (adopted from River's two-axis framework):**

| Axis | Scale |
|---|---|
| **Source strength** | `[PUB]` Published research / `[ANA]` Analogous market inference / `[STR]` Structural logic |
| **GCC specificity** | `[GBL]` Globally confirmed / `[REG]` Regionally inferred / `[DIR]` Directional only |

Read together: `[PUB/GBL]` = highest confidence. `[STR/DIR]` = lowest confidence, treat as hypothesis.

---

## PRIORITY 1 — Decision-Maker Title / Sponsor Profile

### Finding 1.1 — No single universal title; framing determines who leads

The enterprise AI training purchase does not have a single documented decision-maker title. The primary sponsor role is determined by how the initiative is internally framed at the purchasing organisation.

**Two dominant framing patterns documented in literature:**

| Framing | Primary sponsor title | Secondary/co-sponsor |
|---|---|---|
| "Workforce development / upskilling" | CHRO / Chief People Officer | L&D Director, CDO |
| "Technology transformation / AI capability" | CDO / CTO / CIO | CHRO, L&D Director |

`[PUB/GBL]` — McKinsey "State of AI" 2023; Deloitte Human Capital Trends 2024. Both reports document this split explicitly for large enterprise AI capability-building programmes.

**Implication for River:** The register selector is not a single title lookup. It is a framing detector. The question is not "who is the champion?" but "how has this organisation framed its AI training initiative internally?" That framing will be visible in how they describe the problem in early sales conversations.

---

### Finding 1.2 — CHRO authority is elevated in GCC banking specifically

In GCC markets — UAE and KSA particularly — workforce nationalisation programmes (Emiratisation, Saudisation) have given CHROs politically elevated budget authority for workforce development spend. This is structurally distinct from comparable Western markets where L&D budget is more frequently fragmented or delegated.

**What this means in practice:**
- In a GCC bank, the CHRO is more likely to hold or co-hold the GenAI training budget than in a European or North American equivalent of the same size
- Nationalisation compliance creates a defensible internal business case for training investment that the CHRO can carry to the CFO — this reduces friction in the approval chain
- GenAI training that is positioned as workforce development *and* nationalisation-aligned gets access to budget pools that pure technology initiatives do not

`[PUB/REG]` — UAE AI Strategy 2031 and Saudi Vision 2030 Financial Sector Development Programme are publicly documented national policy frameworks. CHRO/CPO elevation in GCC banking is documented in Oliver Wyman and PwC Gulf banking human capital reports. Specific budget authority figures not available without live research.

**Confidence note:** The directional signal here is strong. The precise magnitude of CHRO authority relative to CDO in any specific institution requires primary research or insider knowledge. Treat this as a probable structural pattern, not a confirmed universal.

---

### Finding 1.3 — CDO role is growing rapidly in GCC banking but is newer and variable

CDO/Chief Digital Officer appointments in major GCC banks have accelerated since 2021. Confirmed public appointments include institutions in UAE (FAB, ADCB, Emirates NBD) and KSA (SNB, Al Rajhi, Riyad Bank). However:

- CDO is a newer role in this context — average tenure in GCC banking CDO roles is shorter than CHRO
- Mandate boundaries between CDO, CTO, and CIO are less standardised than in Western markets — the same function may sit under different titles at different institutions
- CDO authority over *people capability* (as opposed to technology infrastructure) is less consistently documented

`[PUB/REG]` — CDO appointment data from publicly available press releases and institutional announcements. Mandate analysis from analogous market inference (Western financial services CDO mandate research applied to GCC context with regional caveat).

**Implication for River:** CDO as champion is plausible and possibly more likely for the technology-framed version of the initiative. But CDO authority to hold the training budget independently (without CHRO co-sponsorship) is less certain in GCC context than in Western markets.

---

### Finding 1.4 — Provisional sponsor profile summary

Based on the above, the most evidence-supported provisional answer to "who is the champion?" is:

**Most likely:** CHRO or CPO, where the initiative is framed as workforce development
**Second most likely:** CDO or CTO, where framed as digital/AI transformation
**Most likely co-sponsor in either case:** The other of the above two

The framing is not fixed at the market level — it will vary institution to institution and potentially within institutions depending on where DivaTech's initial contact lands.

`[STR/REG]` — This synthesis is structural inference drawn from the above findings. It is the most defensible provisional position available without live research. Confidence: directional.

---

## PRIORITY 2 — Buying Committee Structure

### Finding 2.1 — Gartner mobiliser / economic buyer split confirmed as structural baseline

As cited previously: in enterprise B2B purchases at 5,000–60,000 employee scale, the internal champion (mobiliser) and the budget authoriser (economic buyer) are structurally distinct roles in the majority of cases. The champion builds the internal case; the economic buyer approves the spend.

`[PUB/GBL]` — Gartner B2B buying patterns research (multiple cycles, 2019–2024). This is one of the most extensively documented patterns in enterprise sales research.

---

### Finding 2.2 — Typical buying committee composition for enterprise L&D / AI training

In documented enterprise L&D and AI capability-building purchases at regulated financial institutions, the buying committee typically includes the following roles. Note: not all roles are present in every purchase; committee size correlates with deal value.

| Role | Typical function in committee | What they need to feel |
|---|---|---|
| CHRO / CPO | Champion or economic buyer | Strategic alignment, workforce impact, political defensibility |
| CDO / CTO | Technical validator or co-champion | Capability credibility, integration feasibility, vendor AI literacy |
| CFO / Finance Director | Economic buyer or approver | ROI case, cost structure, risk exposure, vendor stability |
| L&D Director / Head of People Development | Operational champion, internal user proxy | Practical delivery, content quality, implementation support |
| Legal / Compliance | Risk gatekeeper | Data handling, regulatory alignment, contractual terms |
| Procurement | Process owner | Vendor due diligence, commercial terms, framework compliance |

`[PUB/GBL]` for committee role existence — Gartner, Forrester, CEB/Gartner "Challenger Sale" research all document this structure for enterprise B2B.
`[ANA/REG]` for GCC financial services specificity — committee composition inferred from analogous regulated financial services markets (UK, EU, US) applied to GCC context. GCC-specific committee research not available without live search.

**Critical caveat:** In GCC banking, the Compliance/Legal gatekeeper role may carry disproportionate weight relative to Western equivalents, given the regulatory environment (CBUAE, SAMA oversight). This is a regional inference, not a confirmed finding. `[STR/DIR]`

---

### Finding 2.3 — Who champions vs. who authorises: the documented pattern

In the majority of documented enterprise AI/L&D purchases:

- **Champion (mobiliser):** CHRO, CDO, or L&D Director — whoever internally owns the problem statement
- **Economic buyer (authoriser):** CFO or C-suite peer of the champion (e.g., CEO for large or strategic spend)
- **Gatekeepers:** Legal/Compliance, Procurement — can block but rarely initiate

The champion's job is to build a coalition and reduce perceived risk for the economic buyer. The economic buyer's job is to approve or deny spend based on the risk/return case the champion presents.

`[PUB/GBL]` — CEB/Gartner "The Challenger Customer" (Adamson et al.) documents this dynamic extensively for large enterprise B2B. This is established, replicated research.

**What this means for the bifocal system:**
- The champion register (pioneer/ambition) needs to give the champion language and evidence they can carry internally — it has to work as advocacy fuel, not just inspiration
- The budget-holder register (clarity/governance) needs to pre-answer the CFO's risk questions before the champion walks into that room — it reduces the champion's internal selling burden
- These two jobs are sequential, not simultaneous — but the brand may be encountered in either order depending on sales motion format

---

### Finding 2.4 — GCC-specific committee dynamic: relationship and trust weighting

One documented regional characteristic relevant to buying committee dynamics in GCC financial services: purchasing decisions at this scale are more heavily relationship-mediated than in comparable Western markets. Vendor selection is influenced by:

- Existing institutional relationships
- Peer endorsements within the GCC banking network (which is relatively small and interconnected)
- Demonstrated presence in the region (local office, regional references, Arabic-language capability)

This does not change the committee structure, but it changes what moves the committee. A technically superior proposal from an unknown vendor may lose to a relationship-backed competitor. `[ANA/REG]`

**Implication for brand:** Credibility signals in the GCC context may need to include regional presence and reference markers, not just global capability claims. This is a fork worth holding in the brand system.

---

## PRIORITY 3–5 — Condensed Findings (secondary priority per River's brief)

### 3. Competitive landscape
Insufficient data available without live research to document named competitors with confidence. Structural inference: the enterprise GenAI training market in GCC is nascent (2023–2025 window), which means early-mover credibility signals carry disproportionate weight. First-mover framing is available and defensible if DivaTech can substantiate regional delivery experience. `[STR/DIR]`

### 4. Buying triggers
Documented triggers for enterprise AI training purchases in financial services:
- Regulatory AI governance requirements (documented and accelerating globally — CBUAE and SAMA have both issued AI-related guidance) `[PUB/REG]`
- Board-level AI strategy mandates (CEOs tasked with AI roadmaps — documented in KPMG and Deloitte CEO surveys 2023–2024) `[PUB/GBL]`
- Competitor pressure / fear of capability gap (widely reported but harder to quantify) `[ANA/GBL]`
- Nationalisation compliance creating L&D budget availability (GCC-specific, see Finding 1.2) `[PUB/REG]`

### 5. Target account identification
Cannot be completed without live research. No directional substitute available from cached knowledge that would be responsibly specific. This data point remains fully gated on TKT-002 block resolution. `[GAP — no provisional output possible]`

---

## Summary table for River — fork resolution guide

| Design decision | Provisional answer | Confidence | Hold or close? |
|---|---|---|---|
| Champion title | CHRO (workforce frame) OR CDO (tech frame) — framing-dependent | `[PUB/REG]` | Hold fork, build both |
| Budget-holder title | CFO or CEO-level peer — consistent across framings | `[PUB/GBL]` | Close fork provisionally |
| Committee size | 4–6 roles typical at this scale in regulated FS | `[PUB/GBL]` | Close fork provisionally |
| Compliance gatekeeper weight | Higher in GCC than Western equivalents | `[STR/DIR]` | Hold fork, flag as risk |
| Relationship mediation in GCC | Significant — regional presence matters | `[ANA/REG]` | Hold fork for brand |
| Register sequencing | Champion encounters brand first; budget-holder via champion materials | `[PUB/GBL]` — pending sales motion confirmation | Hold pending GTM clarification |

---

## What this memo does not resolve

1. **CFO vs. CEO as economic buyer** — depends on deal size and internal governance structure. Not determinable without account-level data.
2. **Exact committee composition at any named target account** — requires primary research.
3. **Whether DivaTech reaches the budget-holder directly** — GTM model question, escalated to Boss, remains open.
4. **Target account list** — no provisional substitute. Fully blocked.
5. **Named competitors with market share data** — fully blocked.

---

*This memo will be superseded by TKT-002 live research outputs when research access is restored. All provisional decisions made on the basis of this memo should be flagged for validation at that point.*

**Document version:** v1 — provisional
**Next review trigger:** TKT-002 unblocked OR Boss supplies internal data
