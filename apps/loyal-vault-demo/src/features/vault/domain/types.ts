/**
 * Read-model types for the loyal-vault-demo feature.
 *
 * Every monetary value crosses JSON as a raw decimal string plus its mint and
 * decimals. No `number` is ever used for money: the SDK's accounting is
 * u64/u128 bigint math and float rounding would corrupt fee/rounding semantics.
 */

export type RawAmount = Readonly<{
  /** Raw integer units as a decimal string. */
  raw: string;
  mint: string;
  decimals: number;
}>;

/** Valuation provenance: what unit, from where, at which slot and time. */
export type ValuationContext = Readonly<{
  quoteUnit: "USDC";
  source: "voltr-vault-account" | "token-account";
  slot: number;
  observedAt: string;
}>;

export type VaultTerms = Readonly<{
  withdrawalWaitingPeriodSeconds: string;
  lockedProfitDegradationSeconds: string;
  maxCapRaw: string;
  issuanceFeeBps: string;
  redemptionFeeBps: string;
  managerPerformanceFeeBps: string;
  adminPerformanceFeeBps: string;
  managementFeeBpsTotal: string;
}>;

/** Disjoint LP supply components; the sum is the accounting supply. */
export type LpSupplyBreakdown = Readonly<{
  /** Circulating LP mint supply. */
  circulating: string;
  /** Accumulated but unharvested LP fee shares (admin + manager + protocol). */
  unharvestedFees: string;
  /** Permanently donated anti-inflation LP. */
  deadWeight: string;
  /** Management-fee LP accrued since the last fee harvest. */
  unrealisedFees: string;
  /** Supply the program actually accounts against. */
  total: string;
}>;

/**
 * Allocation is reported as disjoint, named components. Unknown nonzero
 * exposure is never folded into a remainder: it blocks reconciliation.
 */
export type AllocationComponent = Readonly<{
  key: string;
  kind: "idle-custody" | "strategy-custody" | "unknown";
  /** Adaptor/strategy identity when known. */
  owner?: string;
  amount: RawAmount;
  /** Set when the component could not be attributed to a known catalog entry. */
  unknownReason?: string;
  /** Provenance detail for attributed components (adaptor, write timestamp). */
  note?: string;
  /** Voltr chain time the reported value was last written, when known. */
  lastUpdatedTs?: string;
}>;

export type AllocationView = Readonly<{
  components: readonly AllocationComponent[];
  /** Manager accounting records, excluded from measured custody totals. */
  reportedStrategyValues: readonly AllocationComponent[];
  /** Raw USDC sum of known components. */
  knownTotalRaw: string;
  /** Unknown nonzero exposure blocks reconciliation instead of being hidden. */
  unknownExposure: readonly AllocationComponent[];
  reconciliation: "reconciled" | "unknown-exposure" | "unavailable";
}>;

export type FreshnessView = Readonly<{
  /** Vault account's own manager-write timestamp; NOT NAV freshness. */
  vaultLastUpdatedTs: string;
  vaultLastUpdatedTsIso: string;
  /** Slot/time of this read. */
  observedSlot: number;
  observedAt: string;
  /** True when the vault read and the LP-supply read landed on the same slot. */
  snapshotCoherent: boolean;
  componentSlots: Readonly<Record<string, number>>;
  maxStalenessMs: number;
  /**
   * Chain time of this observation, read from the Clock sysvar in the same
   * batched read as the vault account. Never local wall clock.
   */
  chainTimeSource: "clock-sysvar";
}>;

/**
 * NAV freshness is reported independently of manager writes: a strategy
 * adaptor reporting sequence/slot/NAV of zero is not a fresh NAV, and the
 * vault's `lastUpdatedTs` is a manager write, not a NAV observation.
 */
export type NavFreshnessView = Readonly<{
  reportSignature?: string;
  reportConfirmedSlot?: number;
  status: "fresh" | "stale" | "unknown";
  detail: string;
  /** Manager-written vault timestamp, disclosure only. */
  vaultLastUpdatedTs: string;
  observedSlot: number;
  /** Custom adaptor report fields, decoded in the same batch, when available. */
  adaptorProgram?: string;
  configAddress?: string;
  lastSequence?: string;
  lastObservedSlot?: string;
  lastNavRaw?: string;
  maxReportNavRaw?: string;
  maxReportAgeSlots?: string;
  ageSlots?: string;
  bindingsMatchPinned?: boolean;
}>;

/** Which money-moving actions this read model can actually offer. */
export type ServiceStateView = Readonly<{
  deposits: "available" | "unavailable";
  depositsReason: string;
  withdrawals: "read-only";
  withdrawalsNote: string;
}>;

export type VaultObservation = Readonly<{
  schemaVersion: "loyal-vault-demo.vault-observation/1";
  identity: {
    vault: string;
    voltrProgram: string;
    assetMint: string;
    assetDecimals: number;
    lpMint: string;
    lpDecimals: number;
    manager: string;
    admin: string;
  };
  terms: VaultTerms;
  assetTotalValue: RawAmount;
  /** Idle USDC actually held in vault custody. */
  idleCustody: RawAmount;
  lpSupplyBreakdown: LpSupplyBreakdown;
  allocation: AllocationView;
  /**
   * Value disclosure per whole LP unit (10^lpDecimals raw units),
   * floor-rounded, carrying this snapshot's locked-profit decay and redemption
   * fee. Not a withdrawal quote.
   */
  perLpQuote: Readonly<{
    raw: string;
    lpUnitRaw: string;
    lockedProfitRaw: string;
    redemptionFeeBps: number;
  }>;
  /** Locked profit still decaying in this snapshot. */
  lockedProfitRaw: string;
  valuation: ValuationContext;
  freshness: FreshnessView;
  navFreshness: NavFreshnessView;
  serviceState: ServiceStateView;
  /** Facts that could not be established at all (refusals, undecodable state). */
  unavailable: readonly string[];
  /** Measured absences worth showing (a lane with no receipt, sequence 0). */
  disclosures: readonly string[];
}>;

export type PendingWithdrawalView = Readonly<{
  receiptAddress: string;
  user: string;
  escrowedLp: RawAmount;
  /** u128 U80F48 decimal-bits value as recorded at request time. */
  assetAtRequestRaw: string;
  /** Recomputed from the current snapshot under program rounding. */
  assetAtPresentRaw: string;
  /** Program pays the lower of at-request and at-present. */
  assetEffectiveRaw: string;
  withdrawableFromTs: string;
  withdrawableFromTsIso: string;
  eligibility: "eligible" | "waiting";
  secondsRemaining: string;
  escrowedLpCountedInWalletBalance: boolean;
}>;

export type PositionObservation = Readonly<{
  schemaVersion: "loyal-vault-demo.position-observation/1";
  wallet: string;
  solLamports: string;
  usdc: { balance: RawAmount; accountAddress: string | null };
  lp: { balance: RawAmount; accountAddress: string | null };
  /** Escrowed LP held by the request-withdraw receipt PDA. */
  escrowedLp: RawAmount | null;
  /** Escrow token account balance when that account exists. */
  escrowTokenAccountBalance: RawAmount | null;
  receipt: PendingWithdrawalView | null;
  valuation: ValuationContext;
  freshness: {
    observedSlot: number;
    observedAt: string;
    snapshotCoherent: boolean;
    componentSlots: Readonly<Record<string, number>>;
  };
  unavailable: readonly string[];
}>;

/** Typed read failure. RPC/HTTP problems never collapse into a zero balance. */
export type ReadUnavailable = Readonly<{
  unavailable: true;
  reason: string;
  kind: "rpc-error" | "account-missing" | "invalid-input" | "decode-error";
  detail?: string;
}>;
