# AI Session Log — Greenroom Settlement Case Study

**Date:** 2026-05-19 → 2026-05-20  
**Project:** greenroom-starter (Applied AI PM case study)

---

## 1. Exploration before building
**Prompt:** Understand the current state of the product and data — explore the DB schema, deal types, settlement flow, and user research transcripts. Don't write any code yet.

**Done:** Read the DB schema, queried deal type distribution, read Mariana and Diego's transcripts, mapped the settlement lifecycle. Identified that vs deals (~60% of volume) returned `{ supported: false }` from the calculator.

---

## 2. Fix `calculateSettlement` to handle vs deals
**Prompt:** Rewrite `lib/dealMath.ts` to handle vs deals. Walk through the logic before writing code.

**Done:** Extended `calculateSettlement()` with two vs sub-paths — vs/gross (no expense deductions) and vs/net (hospitality sub-cap → overall expense cap → percentage on net → max(guarantee, backend)). Added a local `usd()` formatter to keep the file free of UI imports. Added `hitBackend`, `guaranteeAmount`, `percentagePayout` to the return type.

---

## 3. Update the settle page UI for vs deals
**Prompt:** Update `app/shows/[id]/settle/page.tsx` so vs deals render a full calculation worksheet instead of the unsupported warning.

**Done:** Added `classifyStep()` to categorize worksheet rows (subtotal / deduction / formula / decision / standard). Built `VsWorksheetRow` with four visual variants. Built `VsSettlement` with a hero total, vs decision callout (brand-tinted if backend wins), full worksheet card, and bonuses. Extracted `SettlementHero` component shared between vs and flat/pog paths.

---

## 4. Debug: some vs shows still showing unsupported
**Prompt:** Show `show_0422` works but The Quiet Houses still shows unsupported. Likely a `percentage_basis = 'gross'` guard rail issue — check and fix.

**Done:** Queried the DB, confirmed 17 shows have `percentage_basis = 'gross'`. The original code returned `{ supported: false }` for these, treating them as data errors. Removed the guard and implemented vs/gross as a legitimate sub-path.

---

## 5. Add `parseDealTerms` server action
**Prompt:** Add a server action that calls the Anthropic API (`claude-sonnet-4-6`) with a show's `notes_freetext` and returns structured deal terms as JSON: guarantee, percentage, basis, expense_cap, hospitality_cap, and any ambiguity flags.

**Done:** Installed `@anthropic-ai/sdk`. Created `lib/actions/parseDealTerms.ts` as a `"use server"` action using structured JSON output via `output_config.format`. Returns `ParsedDealTerms` type with all six fields plus `ambiguity_flags: string[]`.

---

## 6. Wire `parseDealTerms` into the settle page
**Prompt:** On the vs deal settle page, add a panel above the worksheet that calls `parseDealTerms` and displays extracted terms and ambiguity flags as yellow warnings. Label it "AI-parsed deal terms."

**Done:** Called `parseDealTerms` in the async `SettlePage` function (gated on vs deal + freetext present, with `.catch(() => null)` fallback). Built `AiDealPanel` component with term chips (guarantee, percentage, basis, expense_cap, hospitality_cap) and amber `AlertTriangle` warnings for ambiguity flags. Rendered above the vs decision callout.

---

## 7. Debug: AI panel not showing on Coastal Spell
**Prompt:** Check why `parseDealTerms` isn't rendering — likely the API call is failing silently. Add logging and check `ANTHROPIC_API_KEY`.

**Done:** Confirmed `.env` (not `.env.local`) has the key — Next.js loads it fine. Added try/catch logging. Ran `parseDealTerms` in isolation and found the real error: a 400 from the Anthropic API because `basis` used `{ type: ["string", "null"], enum: ["net", "gross", null] }` — invalid JSON Schema (can't mix string values and null in an enum). Fixed by changing to `{ anyOf: [{ type: "string", enum: ["net", "gross"] }, { type: "null" }] }`. Removed debug logging.

---

## 8. Surface signoff conflict on the settle page
**Prompt:** 4 settlements (actually found 22) have `status = 'disputed'` but `signoff_text` says "Looks good" or similar. Surface this conflict visually.

**Done:** Added `hasSignoffConflict` boolean (`status === "disputed" && signoffText is non-empty`). Added an amber callout above the lifecycle bar explaining that the TM agreed in the room but dispute was opened afterward, with the TM's exact sign-off text quoted inline. Distinct from the rose disputed-recoups banner — amber because it's a data integrity problem, not an active action item.

---

## 9. Add expense risk card to show detail page
**Prompt:** Add a risk card to `app/shows/[id]/page.tsx`. Show only when settlement is draft/submitted/in_review. Compare expenses against `expense_cap` and `hospitality_cap` — yellow if over 80%, red if over 100%.

**Done:** Added `getShowById` return type alias `ShowData`. Built `checkCap()` returning `CapStatus` (over/near/ok/no_cap), `CapRow` with a progress bar, and `ExpenseRiskCard` with two cap checks. Gated on vs deals with caps set and early settlement status. Rendered above the expenses table in the show detail grid.

---

## 10. Add contract risk section to the risk card
**Prompt:** Add a second section to the risk card — call `parseDealTerms` on `deal_notes_freetext` and show ambiguity flags. If none, show "no obvious ambiguities found."

**Done:** Imported `parseDealTerms` into the show detail page. Called it in `ShowDetailPage` (gated on `showRiskCard && dealNotesFreetext`, wrapped in try/catch). Passed `ambiguityFlags` prop to `ExpenseRiskCard`. Added "Contract risk · AI-read from deal notes" section inside the card with `AlertCircle` icons for each flag. Renamed card title to "Settlement risk."

---

## 11. Remove the vs-only gate from the risk card
**Prompt:** The risk card should show for all deal types with expense caps, not just vs deals.

**Done:** Changed `showRiskCard` condition from `deal.dealType === "vs"` to `deal.expenseCap != null || deal.hospitalityCap != null`. One-line change.

---

## 12. Add agent dispute history section to the risk card
**Prompt:** Add a third section — query how many disputed settlements this agent has in the last 24 months. Warning if 1+, red if 3+.

**Done:** Added `getAgentDisputeCount(agentId)` to `lib/queries.ts` — joins `settlements → shows → artists` filtered by `agentId`, `status = 'disputed'`, and `date >= 24 months ago`. Imported and called it in `ShowDetailPage` in parallel with `parseDealTerms` via `Promise.all`. Added "Agent dispute history · last 24 months" section to the card with amber/rose coloring and agent name in the message.

---

## 13. Codebase audit
**Prompt:** Do a quick audit — what's working, what's broken or incomplete, what's inconsistent.

**Done:** Spawned an Explore subagent for a thorough read of all modified files. Findings: (1) `parseDealTerms` still used `type: ["number", "null"]` array syntax for numeric nullable fields — inconsistent with the `anyOf` fix applied to `basis`; (2) reports page still classified vs as unsupported; (3) a stale comment said "vs deals only" after the gate was broadened. Everything else (dealMath, queries, settle page props, signoff detection) was clean.

---

## 14. Fix nullable field schemas + update supported deal types
**Prompt:** Make all nullable fields in `parseDealTerms.ts` use `anyOf` consistently. Update `lib/queries.ts` to include vs in supported types.

**Done:** Changed `guarantee`, `percentage`, `percentageDecimal`, `expense_cap`, `hospitality_cap` from `{ type: ["number", "null"] }` to `{ anyOf: [{ type: "number" }, { type: "null" }] }`. Added `"vs"` to `supportedTypes` array in `getReports()`.

---

## 15. Fix reports page deal mix chart
**Prompt:** The deal mix chart still shows vs as SPREADSHEET. Update it to IN TOOL.

**Done:** Changed the `supported` check in the chart from `type === "flat" || type === "percentage_of_gross"` to include `type === "vs"`. Updated the prose description to remove vs from the list of unsupported deal types and note "Vs deals now calculate in-tool."

---

## Files modified

| File | What changed |
|---|---|
| `lib/dealMath.ts` | Added vs/gross and vs/net deal support; local `usd()` formatter; extended return type |
| `lib/actions/parseDealTerms.ts` | New file — server action for AI deal term extraction |
| `lib/queries.ts` | Added `getAgentDisputeCount()`; added vs to supported types |
| `app/shows/[id]/settle/page.tsx` | VsSettlement, VsWorksheetRow, classifyStep, SettlementHero, AiDealPanel, signoff conflict banner |
| `app/shows/[id]/page.tsx` | ExpenseRiskCard with three sections (expense caps, contract risk, agent history) |
| `app/reports/page.tsx` | vs reclassified as in-tool in chart and prose |
