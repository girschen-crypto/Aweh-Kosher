// Pure calculation shared by Worker and tests. Values are VAT-exclusive integer cents.
export type Line = {
  id: string;
  category: "accommodation" | "transport";
  supplierId: string;
  agreementId: string;
  agreementConfirmed: boolean;
  rateBasis: "gross" | "net";
  incomeModel: "commission" | "markup";
  sellingCents: number;
  supplierCostCents: number;
  commissionableCents: number;
  commissionType: "percent" | "fixed";
  commissionBps: number;
  fixedCommissionCents: number;
  commissionDueOn: string;
  description: string;
  supplierReference: string;
};
export type Quote = {
  currency: "ZAR" | "USD" | "EUR" | "GBP";
  lines: Line[];
  serviceFeeCents: number;
  serviceFeeApproval: string;
  processingCents: number;
  discountCents: number;
  revenueReversalCents: number;
  otherDirectCents: number;
  customerRefundCents: number;
  supplierRefundCents: number;
  outputVatCents: number;
  minimumContributionCents: number;
};
export type Receipt = {
  line_id?: string;
  kind: string;
  amount_cents: number;
  currency: string;
};
export function cents(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 1_000_000_000_000
  )
    throw new Error("Amounts must be non-negative integer cents");
  return value;
}
export type EarningsAdjustment = {
  line_id: string;
  kind: "reversal" | "restoration";
  amount_cents: number;
  currency: string;
};
export function calculate(
  q: Quote,
  receipts: Receipt[] = [],
  adjustments: EarningsAdjustment[] = [],
) {
  const reversed = (lineId: string) =>
    adjustments
      .filter((a) => a.line_id === lineId && a.currency === q.currency)
      .reduce(
        (n, a) =>
          n + (a.kind === "reversal" ? a.amount_cents : -a.amount_cents),
        0,
      );
  if (
    !["ZAR", "USD", "EUR", "GBP"].includes(q.currency) ||
    !Array.isArray(q.lines) ||
    q.lines.length > 200
  )
    throw new Error("Invalid quote");
  for (const key of [
    "serviceFeeCents",
    "processingCents",
    "discountCents",
    "revenueReversalCents",
    "otherDirectCents",
    "customerRefundCents",
    "supplierRefundCents",
    "outputVatCents",
    "minimumContributionCents",
  ] as const)
    cents(q[key]);
  let bookingValue = 0,
    supplierCost = 0,
    accommodationRevenue = 0,
    transportRevenue = 0,
    commission = 0;
  const warnings: string[] = [];
  const ids = new Set<string>();
  const lines = q.lines.map((l) => {
    if (!l.id || ids.has(l.id))
      throw new Error("Line references must be unique");
    ids.add(l.id);
    if (
      !["accommodation", "transport"].includes(l.category) ||
      !["gross", "net"].includes(l.rateBasis) ||
      !["commission", "markup"].includes(l.incomeModel) ||
      !["percent", "fixed"].includes(l.commissionType)
    )
      throw new Error("Invalid line terms");
    [
      l.sellingCents,
      l.supplierCostCents,
      l.commissionableCents,
      l.commissionBps,
      l.fixedCommissionCents,
    ].forEach(cents);
    if (l.commissionBps > 10000 || l.commissionableCents > l.sellingCents)
      throw new Error("Invalid commission base or rate");
    if (l.incomeModel === "markup" && l.rateBasis !== "net")
      throw new Error("Markup requires a contracted net rate");
    if (l.incomeModel === "commission" && l.rateBasis !== "gross")
      throw new Error("Commission requires a gross rate");
    let entitlement = 0;
    if (!l.agreementConfirmed)
      warnings.push(
        `${l.description || l.id}: agreement unconfirmed; income excluded`,
      );
    else
      entitlement =
        l.incomeModel === "markup"
          ? l.sellingCents - l.supplierCostCents
          : l.commissionType === "fixed"
            ? l.fixedCommissionCents
            : Number(
                (BigInt(l.commissionableCents) * BigInt(l.commissionBps) +
                  5000n) /
                  10000n,
              );
    if (entitlement > l.sellingCents)
      throw new Error("Income exceeds selling price");
    const cost =
      l.incomeModel === "commission" && l.agreementConfirmed
        ? l.sellingCents - entitlement
        : l.supplierCostCents;
    bookingValue += l.sellingCents;
    supplierCost += cost;
    if (l.category === "accommodation") accommodationRevenue += entitlement;
    else transportRevenue += entitlement;
    if (l.incomeModel === "commission") commission += entitlement;
    const adjustedEntitlement = entitlement - reversed(l.id);
    if (adjustedEntitlement < 0 || reversed(l.id) < 0)
      throw Error("Earnings adjustment exceeds agreed income");
    const collected = receipts
      .filter((r) => r.line_id === l.id && r.currency === q.currency)
      .reduce(
        (s, r) =>
          s +
          (r.kind === "commission"
            ? r.amount_cents
            : r.kind === "commission_reversal"
              ? -r.amount_cents
              : 0),
        0,
      );
    if (
      collected > Math.max(adjustedEntitlement, 0) &&
      l.incomeModel === "commission"
    )
      warnings.push(
        `${l.id}: receipts exceed current commission entitlement; reconcile`,
      );
    return {
      ...l,
      entitlementCents: entitlement,
      adjustedEntitlementCents: adjustedEntitlement,
      supplierPayableCents: cost,
      collectedCents: collected,
      outstandingCents:
        l.incomeModel === "commission"
          ? Math.max(0, adjustedEntitlement - collected)
          : 0,
    };
  });
  const serviceFee = q.serviceFeeApproval ? q.serviceFeeCents : 0;
  if (q.serviceFeeCents && !q.serviceFeeApproval)
    warnings.push("Service fee approval missing; income excluded");
  const grossRevenue = accommodationRevenue + transportRevenue + serviceFee;
  const directCosts = q.processingCents + q.discountCents + q.otherDirectCents;
  const adjustmentReversals = adjustments
    .filter((a) => a.currency === q.currency)
    .reduce(
      (n, a) => n + (a.kind === "reversal" ? a.amount_cents : -a.amount_cents),
      0,
    );
  if (reversed("service_fee") > serviceFee || reversed("service_fee") < 0)
    throw Error("Service fee adjustment exceeds agreed income");
  const netRevenue =
    grossRevenue - q.revenueReversalCents - adjustmentReversals;
  const contribution = netRevenue - directCosts;
  if (grossRevenue <= 0) warnings.push("No agreed commercial income");
  if (contribution <= q.minimumContributionCents)
    warnings.push("Contribution is at or below the required minimum");
  const actualIncome = receipts
    .filter((r) => r.currency === q.currency)
    .reduce(
      (s, r) =>
        s +
        (["commission", "markup", "service_fee"].includes(r.kind)
          ? r.amount_cents
          : r.kind.endsWith("_reversal")
            ? -r.amount_cents
            : 0),
      0,
    );
  const actualDirectCosts = receipts
    .filter((r) => r.currency === q.currency && r.kind === "direct_cost")
    .reduce((s, r) => s + r.amount_cents, 0);
  return {
    currency: q.currency,
    lines,
    bookingValueCents:
      bookingValue + q.serviceFeeCents - q.discountCents + q.outputVatCents,
    supplierCostCents: supplierCost,
    accommodationRevenueCents: accommodationRevenue,
    transportRevenueCents: transportRevenue,
    serviceFeeCents: serviceFee,
    grossRevenueCents: grossRevenue,
    netRevenueCents: netRevenue,
    directCostsCents: directCosts,
    contributionCents: contribution,
    marginPercent: netRevenue > 0 ? (contribution / netRevenue) * 100 : null,
    commissionDueCents:
      commission -
      lines
        .filter((l) => l.incomeModel === "commission")
        .reduce((n, l) => n + reversed(l.id), 0),
    earningsAdjustmentCents: adjustmentReversals,
    commissionCollectedCents: lines.reduce((s, l) => s + l.collectedCents, 0),
    commissionOutstandingCents: lines.reduce(
      (s, l) => s + l.outstandingCents,
      0,
    ),
    actualIncomeCents: actualIncome,
    actualDirectCostsCents: actualDirectCosts,
    cashContributionCents: actualIncome - actualDirectCosts,
    customerRefundCents: q.customerRefundCents,
    supplierRefundCents: q.supplierRefundCents,
    warnings,
  };
}
export const emptyQuote: Quote = {
  currency: "ZAR",
  lines: [],
  serviceFeeCents: 0,
  serviceFeeApproval: "",
  processingCents: 0,
  discountCents: 0,
  revenueReversalCents: 0,
  otherDirectCents: 0,
  customerRefundCents: 0,
  supplierRefundCents: 0,
  outputVatCents: 0,
  minimumContributionCents: 0,
};
