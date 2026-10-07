# Leadora / Leadorra Feature Adoption Matrix — October 2026

This document records product patterns observed from the public Leadora / Leadorra product pages and the corresponding Atlas ecosystem adoption decisions.

## Products reviewed

1. Leadora OS — https://www.leadora.ca/
2. Leadora Cloud — https://leadora.cloud/
3. Leadora Revenue Intelligence — https://www.leadora.co/
4. Leadora Platform — https://www.platformleadora.com/pricing
5. Leadora Live — https://leadora.live/
6. Leadora Tech — https://leadora.tech/
7. Leadora AI sales tool — https://leadora.gumroad.com/l/leadora
8. Leadora Global — https://www.leadoraglobal.com/
9. Leadorra Apps / Evidence Pack Builder — https://leadorra.com/

## High-value product patterns

| Pattern | Observed capability | Atlas adoption |
| --- | --- | --- |
| Lead response | AI sales agent, instant response | Existing agent + new lead-intelligence signals |
| Qualification | Smart/AI qualification and lead scoring | scoreLeadIntelligence() |
| Booking | Auto booking and appointment protection | recommendNextBestAction() |
| Follow-up | Automated follow-ups, reactivation and no-show recovery | recommendNextBestAction() + existing follow-up fabric |
| CRM execution | Contacts, leads, stages, owners and next steps | Existing Growth Suite |
| Unified conversations | Multi-channel inbox with conversation history | Existing Copilot / Communications |
| Business knowledge | Catalog, pricing, policies and sources for grounded replies | Existing support/runtime boundary; extraction agent now detects knowledge signals |
| Campaign targeting | Stage/source/tag/score based segmentation | Existing Growth / automation fabric |
| Automation | Trigger → condition → action builder with simulation/history | Existing automation fabric |
| Revenue intelligence | ICP, decision-maker mapping, market intelligence, business intelligence | New atlas-revenue-intelligence package |
| Next-best-action | Context-aware action recommendation | New recommendNextBestAction() |
| Forecasting | Weighted pipeline / revenue forecasting and risk signals | New forecastPipeline() + boardroom snapshot |
| Bid intelligence | Requirements, past performance, pricing and delivery risk | New scoreBidOffer() |
| Executive cockpit | AI Boardroom / Deal Room / Digital Twin concepts | New buildRevenueBoardroomSnapshot() as deterministic control-plane foundation |
| Evidence / proof | Local evidence packs, captions, hashes, manifest | Inspector already uses evidence-first reporting |
| Lead acquisition | B2B crawler, CSV import + duplicate detection | Inspector roadmap; avoid unsafe/unbounded scraping |
| Sales enablement | Call scripts, templates, playbooks | Existing template/workflow layer; Our Tools gets follow-up sequence builder |
| Gamification | Leaderboards, streaks, team motivation | Candidate future Atlas growth-surface feature |
| Affiliate/referral | Product catalog, direct selling, commissions | Existing affiliate system in Growth Suite |

## What was deliberately not copied

- Private backend behavior or source code.
- Credentials, cookies, local storage, session data or authorization headers.
- Unbounded scraping, automated account creation or destructive actions.
- Vendor claims that could not be independently observed from public browser evidence.

## New repository surfaces

### Atlas
packages/atlas-revenue-intelligence/

Deterministic building blocks for:
- lead scoring
- buying committee mapping
- next best action
- pipeline forecasting
- bid / offer scoring
- executive revenue snapshot

The module is also re-exported from packages/growth-suite/index.mjs.

### Website Inspector
src/agents/revenue-intelligence-agent.mjs

Adds evidence-first extraction for:
- ICP and decision-maker signals
- market / business intelligence agents
- revenue features and automations
- channels and integrations
- pricing and CTAs
- knowledge and proof signals
- competitive gaps and adoption opportunities

MCP tool:
extract_revenue_intelligence

### Our Tools
Added browser-local utilities:
- Lead Score Calculator
- Pipeline Forecast
- Next Best Action
- Follow-up Sequence Builder

These do not transmit user data to third parties.
