/**
 * Deal calculation logic for the in-app settlement tool.
 *
 * IMPORTANT — DELIBERATELY INCOMPLETE.
 *
 * Supported deal types:
 *
 *   1. flat                 — $X guaranteed, optional sellout bonus
 *   2. percentage_of_gross  — X% of gross, no expense deductions, optional sellout bonus
 *   3. vs                   — guarantee vs % of net after expenses, whichever greater;
 *                             supports expense cap and hospitality sub-cap
 *
 * For supported deal types, bonuses in `bonusesJson` are evaluated and applied.
 * Bonuses that exist only in `dealNotesFreetext` are invisible to this engine
 * until the AI parsing layer extracts them into structured form.
 *
 * Still NOT handled (returns { supported: false }):
 *
 *   - percentage_of_net deals (no guarantee floor — structurally similar to vs)
 *   - door deals
 *   - recoups (flow separately through the settlement record)
 *   - tier ratchets (reported in bonusesNotTriggered with explanation)
 *   - comps that count toward gross
 */

import type { Deal, Expense, TicketSale, Bonus } from "@/db/schema";

/** Minimal money formatter for note strings — keeps dealMath free of UI imports. */
function usd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}

export type SettlementCalculation =
  | {
      supported: true;
      grossBoxOffice: number;
      netBoxOffice: number;
      totalExpenses: number;
      totalToArtist: number;
      steps: { label: string; value: number; note?: string }[];
      finalFormula: string;
      // Bonuses that were applied. Empty array if no bonuses on the deal,
      // or if no bonuses triggered.
      bonusesApplied: { label: string; amount: number; reason: string }[];
      // Bonuses that exist on the deal but didn't trigger (helpful context).
      bonusesNotTriggered: { label: string; amount: number; reason: string }[];
      // vs deal only — undefined for flat and percentage_of_gross
      hitBackend?: boolean;
      guaranteeAmount?: number;
      percentagePayout?: number;
    }
  | {
      supported: false;
      reason: string;
      dealType: Deal["dealType"];
    };

interface CalcInput {
  deal: Deal;
  ticketSales: TicketSale[];
  expenses: Expense[];
  // Capacity is needed to evaluate sellout bonuses. Optional — if omitted,
  // sellout bonuses are reported as "can't determine".
  venueCapacity?: number;
  ticketsSold?: number;
}

export function parseBonuses(deal: Deal): Bonus[] {
  if (!deal.bonusesJson) return [];
  try {
    const parsed = JSON.parse(deal.bonusesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function calculateSettlement(input: CalcInput): SettlementCalculation {
  const { deal, ticketSales, expenses, venueCapacity, ticketsSold } = input;

  const grossBoxOffice = ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const totalFees = ticketSales.reduce((sum, t) => sum + t.fees, 0);
  const netBoxOffice = grossBoxOffice - totalFees;
  const totalExpenses = expenses
    .filter((e) => !e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);

  const tickets =
    ticketsSold ?? ticketSales.reduce((sum, t) => sum + (t.qty ?? 0), 0);

  // ---------- flat guarantee ----------
  if (deal.dealType === "flat") {
    if (deal.guaranteeAmount == null) {
      return {
        supported: false,
        reason: "Flat deal is missing a guarantee amount.",
        dealType: deal.dealType,
      };
    }
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      totalToArtist: deal.guaranteeAmount + bonusResult.totalApplied,
      steps: [
        {
          label: "Flat guarantee",
          value: deal.guaranteeAmount,
          note: "No expense deductions. The guarantee is the floor.",
        },
        ...bonusResult.applied.map((b) => ({
          label: b.label,
          value: b.amount,
          note: b.reason,
        })),
      ],
      finalFormula: bonusResult.applied.length
        ? `flat ${deal.guaranteeAmount} + bonuses ${bonusResult.totalApplied} = ${(deal.guaranteeAmount + bonusResult.totalApplied).toFixed(2)}`
        : `flat guarantee = ${deal.guaranteeAmount}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }

  // ---------- percentage of gross ----------
  if (deal.dealType === "percentage_of_gross") {
    if (deal.percentage == null) {
      return {
        supported: false,
        reason: "Percentage-of-gross deal is missing a percentage.",
        dealType: deal.dealType,
      };
    }
    const payout = grossBoxOffice * deal.percentage;
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      totalToArtist: payout + bonusResult.totalApplied,
      steps: [
        { label: "Gross box office", value: grossBoxOffice },
        {
          label: `× ${(deal.percentage * 100).toFixed(0)}%`,
          value: payout,
          note: "Percentage of gross — no expense deductions.",
        },
        ...bonusResult.applied.map((b) => ({
          label: b.label,
          value: b.amount,
          note: b.reason,
        })),
      ],
      finalFormula: bonusResult.applied.length
        ? `gross × ${deal.percentage} + bonuses = ${(payout + bonusResult.totalApplied).toFixed(2)}`
        : `gross × ${deal.percentage} = ${payout.toFixed(2)}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }

  // ---------- vs deal (guarantee vs % of net after expenses) ----------
  if (deal.dealType === "vs") {
    if (deal.guaranteeAmount == null) {
      return { supported: false, reason: "Vs deal is missing a guarantee amount.", dealType: deal.dealType };
    }
    if (deal.percentage == null) {
      return { supported: false, reason: "Vs deal is missing a percentage.", dealType: deal.dealType };
    }
    const pct = deal.percentage; // stored as decimal, e.g. 0.80
    const guarantee = deal.guaranteeAmount;
    const pctLabel = `${(pct * 100).toFixed(0)}%`;

    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    // ---------- vs/gross: no expense deductions ----------
    if (deal.percentageBasis === "gross") {
      const percentagePayout = grossBoxOffice * pct;
      const hitBackend = percentagePayout > guarantee;
      const basePayout = hitBackend ? percentagePayout : guarantee;

      const steps: { label: string; value: number; note?: string }[] = [
        { label: "Gross box office", value: grossBoxOffice },
        {
          label: `× ${pctLabel} = percentage payout`,
          value: percentagePayout,
          note: "Gross deal — no expense deductions",
        },
        {
          label: hitBackend ? `Guarantee (${usd(guarantee)}) — backend wins` : `Guarantee — guarantee wins`,
          value: hitBackend ? percentagePayout : guarantee,
          note: hitBackend
            ? `${usd(percentagePayout)} > ${usd(guarantee)} — artist gets the percentage`
            : `${usd(percentagePayout)} ≤ ${usd(guarantee)} — artist gets the guarantee`,
        },
        ...bonusResult.applied.map((b) => ({ label: b.label, value: b.amount, note: b.reason })),
      ];

      const backendStr = hitBackend
        ? `backend ${usd(percentagePayout)} > guarantee ${usd(guarantee)} → ${pctLabel} of gross`
        : `guarantee ${usd(guarantee)} > backend ${usd(percentagePayout)} → flat guarantee`;

      return {
        supported: true,
        grossBoxOffice,
        netBoxOffice,
        totalExpenses,
        totalToArtist: basePayout + bonusResult.totalApplied,
        steps,
        finalFormula: bonusResult.applied.length
          ? `${backendStr} + bonuses ${usd(bonusResult.totalApplied)} = ${usd(basePayout + bonusResult.totalApplied)}`
          : backendStr,
        bonusesApplied: bonusResult.applied,
        bonusesNotTriggered: bonusResult.notTriggered,
        hitBackend,
        guaranteeAmount: guarantee,
        percentagePayout,
      };
    }

    // ---------- vs/net: guarantee vs % of net after expenses ----------
    // Apply hospitality sub-cap before summing total expenses.
    const hospitalityCap = deal.hospitalityCap ?? Infinity;
    let hospitalityTotal = 0;
    let otherExpensesTotal = 0;
    for (const e of expenses) {
      if (e.absorbedByVenue) continue;
      if (e.category === "hospitality") {
        hospitalityTotal += e.amount;
      } else {
        otherExpensesTotal += e.amount;
      }
    }
    const cappedHospitality = Math.min(hospitalityTotal, hospitalityCap);
    const summedExpenses = cappedHospitality + otherExpensesTotal;

    // Apply overall expense cap.
    const expenseCap = deal.expenseCap ?? Infinity;
    const effectiveExpenses = Math.min(summedExpenses, expenseCap);

    // Net after fees and expenses; floor at 0 for percentage calculation.
    const netAfterExpenses = netBoxOffice - effectiveExpenses;
    const percentagePayout = Math.max(0, netAfterExpenses) * pct;

    const hitBackend = percentagePayout > guarantee;
    const basePayout = hitBackend ? percentagePayout : guarantee;

    const steps: { label: string; value: number; note?: string }[] = [
      { label: "Gross box office", value: grossBoxOffice },
      { label: "Less: ticket fees", value: -totalFees },
      { label: "= Net box office", value: netBoxOffice },
    ];

    if (hospitalityTotal > 0 && deal.hospitalityCap != null && hospitalityTotal > hospitalityCap) {
      steps.push({
        label: `Hospitality expenses (capped at ${usd(hospitalityCap)})`,
        value: -cappedHospitality,
        note: `Raw total was ${usd(hospitalityTotal)}; cap of ${usd(hospitalityCap)} applied`,
      });
    } else if (cappedHospitality > 0) {
      steps.push({ label: "Hospitality expenses", value: -cappedHospitality });
    }

    if (otherExpensesTotal > 0) {
      steps.push({ label: "Other passed-through expenses", value: -otherExpensesTotal });
    }

    if (deal.expenseCap != null && summedExpenses > expenseCap) {
      steps.push({
        label: `Expense cap applied`,
        value: effectiveExpenses - summedExpenses, // negative adjustment
        note: `Raw expenses ${usd(summedExpenses)} reduced to cap of ${usd(expenseCap)}`,
      });
    }

    steps.push({ label: "= Net after expenses", value: netAfterExpenses });
    steps.push({
      label: `× ${pctLabel} = percentage payout`,
      value: percentagePayout,
      note: netAfterExpenses < 0
        ? "Net was negative; percentage floored at $0"
        : undefined,
    });
    steps.push({
      label: hitBackend ? `Guarantee (${usd(guarantee)}) — backend wins` : `Guarantee — guarantee wins`,
      value: hitBackend ? percentagePayout : guarantee,
      note: hitBackend
        ? `${usd(percentagePayout)} > ${usd(guarantee)} — artist gets the percentage`
        : `${usd(percentagePayout)} ≤ ${usd(guarantee)} — artist gets the guarantee`,
    });

    for (const b of bonusResult.applied) {
      steps.push({ label: b.label, value: b.amount, note: b.reason });
    }

    const backendStr = hitBackend
      ? `backend ${usd(percentagePayout)} > guarantee ${usd(guarantee)} → ${pctLabel} of net`
      : `guarantee ${usd(guarantee)} > backend ${usd(percentagePayout)} → flat guarantee`;

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses: effectiveExpenses,
      totalToArtist: basePayout + bonusResult.totalApplied,
      steps,
      finalFormula: bonusResult.applied.length
        ? `${backendStr} + bonuses ${usd(bonusResult.totalApplied)} = ${usd(basePayout + bonusResult.totalApplied)}`
        : backendStr,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
      hitBackend,
      guaranteeAmount: guarantee,
      percentagePayout,
    };
  }

  // ---------- everything else: not supported ----------
  const friendlyName: Record<Deal["dealType"], string> = {
    flat: "Flat guarantee",
    percentage_of_gross: "Percentage of gross",
    percentage_of_net: "Percentage of net",
    vs: "Vs deal (guarantee vs %)",
    door: "Door deal",
  };

  return {
    supported: false,
    dealType: deal.dealType,
    reason:
      `${friendlyName[deal.dealType]} deals aren't supported in the in-app tool yet. ` +
      `Power users at venues like The Crescent default to spreadsheets for these.`,
  };
}

/** Evaluate a list of bonuses against the show's actual numbers. */
function applyBonuses(
  bonuses: Bonus[],
  ctx: { gross: number; tickets: number; capacity?: number },
) {
  const applied: { label: string; amount: number; reason: string }[] = [];
  const notTriggered: { label: string; amount: number; reason: string }[] = [];

  for (const b of bonuses) {
    if (b.type === "gross_threshold") {
      if (ctx.gross >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross ${ctx.gross.toLocaleString()} ≥ ${b.threshold.toLocaleString()}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross ${ctx.gross.toLocaleString()} < ${b.threshold.toLocaleString()}`,
        });
      }
    } else if (b.type === "sellout") {
      if (ctx.capacity != null && ctx.tickets >= ctx.capacity * 0.95) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} of ${ctx.capacity} sold`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason:
            ctx.capacity != null
              ? `${ctx.tickets} of ${ctx.capacity} sold (sellout = ≥95%)`
              : `Capacity unknown — can't evaluate`,
        });
      }
    } else if (b.type === "attendance_threshold") {
      if (ctx.tickets >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} ≥ ${b.threshold}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} < ${b.threshold}`,
        });
      }
    } else if (b.type === "tier_ratchet") {
      // Tier ratchets fundamentally change the percentage structure. The
      // current engine only supports flat % of gross — we can't apply a
      // ratcheting structure on top of it without knowing which deal type
      // it's modifying. Report as not-applicable.
      notTriggered.push({
        label: b.label,
        amount: 0,
        reason: "Tier ratchets need vs-deal or % of net support — not yet handled",
      });
    }
  }

  return {
    applied,
    notTriggered,
    totalApplied: applied.reduce((s, b) => s + b.amount, 0),
  };
}
