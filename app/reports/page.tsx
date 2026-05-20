import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { getReports } from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney, formatMoneyCompact } from "@/lib/format";

export default async function ReportsPage() {
  const r = await getReports();

  const dealMix = Object.entries(r.dealTypeCounts)
    .map(([type, count]) => ({
      type,
      count,
      pct: r.totalDeals > 0 ? count / r.totalDeals : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const lifecycleOrder = [
    "draft",
    "submitted",
    "in_review",
    "signed",
    "disputed",
    "revised",
    "finalized",
    "paid",
    "voided",
  ];
  const lifecycleData = lifecycleOrder
    .map((stage) => ({
      stage,
      count: r.settlementStatus[stage] ?? 0,
      pct: r.totalSettlements > 0
        ? (r.settlementStatus[stage] ?? 0) / r.totalSettlements
        : 0,
    }))
    .filter((d) => d.count > 0);

  const maxLifecycleCount = Math.max(...lifecycleData.map((d) => d.count));

  const inFlight =
    (r.settlementStatus.draft ?? 0) +
    (r.settlementStatus.submitted ?? 0) +
    (r.settlementStatus.in_review ?? 0) +
    (r.settlementStatus.signed ?? 0) +
    (r.settlementStatus.finalized ?? 0);

  const unsupportedPct = (100 - r.inAppToolUsageRate * 100).toFixed(0);
  const disputedPct = (r.disputedRate * 100).toFixed(1);

  return (
    <div className="px-12 py-10 max-w-7xl">
      {/* Hero */}
      <div className="mb-16">
        <div className="eyebrow mb-3">Last 24 months</div>
        <h1
          className="font-display text-[48px] font-medium text-ink-900 leading-[1.05]"
          style={{ letterSpacing: "-0.02em", fontOpticalSizing: "auto" }}
        >
          Reports
        </h1>
        <p className="text-[14px] text-ink-500 mt-3 max-w-xl leading-relaxed">
          Aggregate metrics for The Crescent. The numbers the CEO is watching.
        </p>
      </div>

      {/* CEO memo */}
      <div className="rounded-xl border border-amber-200/60 bg-gradient-to-r from-amber-50/60 to-canvas p-6 flex gap-4 mb-10">
        <div className="w-9 h-9 rounded-lg bg-white ring-1 ring-amber-200/50 flex items-center justify-center shrink-0">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
        </div>
        <div>
          <div className="eyebrow text-[10px] text-amber-800 mb-2">
            From Pri&apos;s Q4 memo
          </div>
          <p className="text-[13.5px] text-ink-800 leading-relaxed">
            &ldquo;Our settlement experience is the place we are most clearly
            losing on craft. Our customers love us in spite of it, not because
            of it.&rdquo;{" "}
            <Link
              href="/context"
              className="font-medium text-brand-700 hover:text-brand-800 hover:underline inline-flex items-center gap-0.5"
            >
              Read the full memo
              <ArrowRight className="h-3 w-3" />
            </Link>
          </p>
        </div>
      </div>

      {/* Metrics strip */}
      <div className="flex items-baseline gap-10 pt-6 border-t border-ink-200/60 mb-14">
        <Stat label="Shows in window" value={String(r.showCount)} />
        <Stat label="Settled" value={String(r.settledCount)} accent />
        <Stat label="Gross box office" value={formatMoneyCompact(r.totalGross)} mono />
        <Stat label="Paid to artists" value={formatMoneyCompact(r.totalToArtists)} mono />
      </div>

      {/* Settlement craft gap — THE visual anchor */}
      <div className="mb-16">
        <h2
          className="font-display text-[28px] font-medium text-ink-900 mb-8"
          style={{ letterSpacing: "-0.02em" }}
        >
          Settlement craft gap
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="relative overflow-hidden rounded-xl border border-amber-200/60 bg-gradient-to-br from-amber-50/50 to-canvas p-8">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-amber-300 to-amber-700" />
            <div className="absolute -bottom-8 -right-8 w-32 h-32 bg-amber-100/30 rounded-full blur-2xl" />
            <div className="relative">
              <div className="eyebrow text-[10px] text-amber-800 mb-3">
                Deals unsupported by tool
              </div>
              <div
                className="text-[64px] font-mono tabular font-bold text-amber-800 leading-none"
                style={{ letterSpacing: "-0.03em" }}
              >
                {unsupportedPct}%
              </div>
              <p className="text-[12.5px] text-ink-600 mt-4 leading-relaxed max-w-sm">
                At The Crescent, {unsupportedPct}% of deals — % of net and
                door deals — are deal types the in-app tool can&apos;t settle.
                Vs deals now calculate in-tool. Across all customers, only about 18% actively use the tool at all.
              </p>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-xl border border-rose-200/60 bg-gradient-to-br from-rose-50/40 to-canvas p-8">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-rose-300 to-rose-700" />
            <div className="absolute -bottom-8 -right-8 w-32 h-32 bg-rose-100/30 rounded-full blur-2xl" />
            <div className="relative">
              <div className="eyebrow text-[10px] text-rose-800 mb-3">
                Disputed settlements
              </div>
              <div
                className="text-[64px] font-mono tabular font-bold text-rose-800 leading-none"
                style={{ letterSpacing: "-0.03em" }}
              >
                {disputedPct}%
              </div>
              <p className="text-[12.5px] text-ink-600 mt-4 leading-relaxed max-w-sm">
                {r.settlementStatus.disputed ?? 0} of {r.totalSettlements} past
                settlements ended in some form of dispute — either a withheld
                signature or a back-and-forth that altered the final number.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Settlement funnel */}
      <div className="mb-16">
        <h2
          className="font-display text-[24px] font-medium text-ink-900 mb-2"
          style={{ letterSpacing: "-0.02em" }}
        >
          Settlement lifecycle
        </h2>
        <p className="text-[13px] text-ink-500 mb-6 max-w-2xl leading-relaxed">
          Where the {r.totalSettlements} settlements at The Crescent currently
          sit. {inFlight} are still in flight — drafted but not yet paid.
        </p>
        <div className="space-y-[6px]">
          {lifecycleData.map(({ stage, count, pct }) => {
            const isProblem =
              stage === "disputed" || stage === "revised" || stage === "voided";
            const isDone = stage === "paid";
            const barWidth = maxLifecycleCount > 0 ? (count / maxLifecycleCount) * 100 : 0;
            return (
              <div key={stage} className="flex items-center gap-3 group">
                <div className="w-20 text-right">
                  <span className="text-[12px] font-medium text-ink-600 capitalize">
                    {stage.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <div
                    className={`h-7 rounded-[4px] transition-all duration-300 flex items-center min-w-[28px] ${
                      isProblem
                        ? "bg-rose-500/90"
                        : isDone
                          ? "bg-brand-700/90"
                          : "bg-sky-500/80"
                    }`}
                    style={{ width: `${Math.max(barWidth, 3)}%` }}
                  >
                    <span className="text-[11px] font-mono tabular font-medium text-white px-2">
                      {count}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono tabular text-ink-400">
                    {(pct * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recoups */}
      {r.settlementsWithRecoups > 0 && (
        <div className="mb-16">
          <h2
            className="font-display text-[24px] font-medium text-ink-900 mb-2"
            style={{ letterSpacing: "-0.02em" }}
          >
            Recoups
          </h2>
          <p className="text-[13px] text-ink-500 mb-5 max-w-2xl leading-relaxed">
            Venue costs taken off the top before artist payment. The most
            frequent source of settlement disputes — exactly the seam in the
            Coastal Spell thread.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SmallMetric
              label="Settlements with recoups"
              value={String(r.settlementsWithRecoups)}
              subtext={`${((r.settlementsWithRecoups / r.totalSettlements) * 100).toFixed(0)}% of past settlements`}
            />
            <SmallMetric
              label="Total recouped"
              value={formatMoneyCompact(r.totalRecoupValue)}
              mono
            />
            <SmallMetric
              label="Disputed recoup value"
              value={formatMoney(r.disputedRecoupValue)}
              mono
              alarming={r.disputedRecoupValue > 0}
            />
          </div>
        </div>
      )}

      {/* Comps */}
      <div className="mb-16">
        <h2
          className="font-display text-[24px] font-medium text-ink-900 mb-2"
          style={{ letterSpacing: "-0.02em" }}
        >
          Comps
        </h2>
        <p className="text-[13px] text-ink-500 mb-5 max-w-2xl leading-relaxed">
          Comp tickets given away across all shows. Whether comps count toward
          gross is a deal-by-deal call — and a recurring source of friction.
        </p>
        <Card>
          <CardContent>
            <div className="grid grid-cols-3 gap-6 mb-6 pb-5 border-b border-ink-100/60">
              <div>
                <div className="eyebrow text-[10px] text-ink-400 mb-1">
                  Total comp tickets
                </div>
                <div className="text-[24px] font-mono tabular font-semibold text-ink-900">
                  {r.totalCompTickets.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="eyebrow text-[10px] text-ink-400 mb-1">
                  Face value foregone
                </div>
                <div className="text-[24px] font-mono tabular font-semibold text-ink-900">
                  {formatMoneyCompact(r.totalCompFaceValue)}
                </div>
              </div>
              <div>
                <div className="eyebrow text-[10px] text-ink-400 mb-1">
                  Per show (avg)
                </div>
                <div className="text-[24px] font-mono tabular font-semibold text-ink-900">
                  {Math.round(r.totalCompTickets / r.showCount)}
                </div>
              </div>
            </div>
            <div className="space-y-[6px]">
              {Object.entries(r.compsByCategory)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, count]) => {
                  const pct =
                    r.totalCompTickets > 0 ? count / r.totalCompTickets : 0;
                  const maxCount = Math.max(
                    ...Object.values(r.compsByCategory),
                  );
                  const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;
                  const labels: Record<string, string> = {
                    artist_gl: "Artist guest list",
                    label: "Label / management",
                    press: "Press",
                    venue_staff: "Venue staff",
                    sponsor: "Sponsor",
                    promo: "Promo / radio",
                    other: "Other",
                  };
                  return (
                    <div key={cat} className="flex items-center gap-3">
                      <div className="w-32 text-right">
                        <span className="text-[12px] text-ink-600">
                          {labels[cat] ?? cat}
                        </span>
                      </div>
                      <div className="flex-1 flex items-center gap-2">
                        <div
                          className="h-6 rounded-[3px] bg-ink-300/80 flex items-center min-w-[24px]"
                          style={{ width: `${Math.max(barWidth, 3)}%` }}
                        >
                          <span className="text-[10px] font-mono tabular font-medium text-white px-1.5">
                            {count.toLocaleString()}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono tabular text-ink-400">
                          {(pct * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Deal mix */}
      <div className="mb-10">
        <h2
          className="font-display text-[24px] font-medium text-ink-900 mb-5"
          style={{ letterSpacing: "-0.02em" }}
        >
          Deal mix
        </h2>
        <Card>
          <CardContent>
            <div className="space-y-[6px]">
              {dealMix.map(({ type, count, pct }) => {
                const supported =
                  type === "flat" || type === "percentage_of_gross" || type === "vs";
                const maxCount = Math.max(...dealMix.map((d) => d.count));
                const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;
                const friendly: Record<string, string> = {
                  flat: "Flat",
                  percentage_of_gross: "% of gross",
                  percentage_of_net: "% of net",
                  vs: "Vs deal",
                  door: "Door deal",
                };
                return (
                  <div key={type} className="flex items-center gap-3">
                    <div className="w-24 text-right flex items-center justify-end gap-1.5">
                      <span className="text-[12px] font-medium text-ink-900">
                        {friendly[type] ?? type}
                      </span>
                    </div>
                    <div className="flex-1 flex items-center gap-2">
                      <div
                        className={`h-7 rounded-[4px] flex items-center min-w-[28px] ${
                          supported ? "bg-brand-700/90" : "bg-amber-500/90"
                        }`}
                        style={{ width: `${Math.max(barWidth, 3)}%` }}
                      >
                        <span className="text-[11px] font-mono tabular font-medium text-white px-2">
                          {count}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono tabular text-ink-400">
                          {(pct * 100).toFixed(0)}%
                        </span>
                        {supported ? (
                          <span className="text-[9px] text-brand-700 uppercase tracking-[0.08em] font-semibold">
                            in tool
                          </span>
                        ) : (
                          <span className="text-[9px] text-amber-700 uppercase tracking-[0.08em] font-semibold">
                            spreadsheet
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="text-[11.5px] text-ink-400 leading-relaxed">
        {r.dealsWithBonuses} of {r.totalDeals} deals carry structured bonuses
        in{" "}
        <code className="font-mono text-[10px] bg-ink-100/60 px-1 py-0.5 rounded">
          bonuses_json
        </code>
        . An unknown number more sit only in the deal-notes prose.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono = false,
  accent = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="eyebrow text-[10px] text-ink-400">{label}</div>
      <div
        className={`text-[28px] font-display font-medium mt-1 leading-none ${
          accent ? "text-brand-700" : "text-ink-900"
        } ${mono ? "font-mono tabular !font-semibold !font-[unset]" : ""}`}
        style={!mono ? { letterSpacing: "-0.02em" } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function SmallMetric({
  label,
  value,
  subtext,
  mono = false,
  alarming = false,
}: {
  label: string;
  value: string;
  subtext?: string;
  mono?: boolean;
  alarming?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-5 ${
        alarming
          ? "border-rose-200/60 bg-rose-50/20"
          : "border-ink-200/60 bg-white"
      }`}
    >
      <div
        className={`eyebrow text-[10px] ${
          alarming ? "text-rose-700" : "text-ink-400"
        }`}
      >
        {label}
      </div>
      <div
        className={`text-[24px] font-semibold mt-1.5 leading-none ${
          alarming ? "text-rose-700" : "text-ink-900"
        } ${mono ? "font-mono tabular" : ""}`}
      >
        {value}
      </div>
      {subtext && (
        <div className="text-[11px] text-ink-400 mt-2">{subtext}</div>
      )}
    </div>
  );
}
