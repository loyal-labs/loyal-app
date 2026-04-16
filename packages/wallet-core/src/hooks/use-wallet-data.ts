import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import type {
	PortfolioPosition,
	PortfolioSnapshot,
	SolanaWalletDataClient,
	WalletActivity,
} from "@loyal-labs/solana-wallet";
import type { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCachedKaminoLendingApyBps } from "../lib/kamino-apy";
import { getTokenIconUrl } from "../lib/token-icon";
import type { ActivityRow, TokenRow, TransactionDetail } from "../types/wallet";

export type BalanceHistoryPoint = {
	timestamp: number;
	valueUsd: number;
};

export type WalletDesktopData = {
	walletAddress: string | null;
	isConnected: boolean;
	isLoading: boolean;
	balanceWhole: string;
	balanceFraction: string;
	balanceSolLabel: string;
	walletLabel: string;
	tokenRows: TokenRow[];
	allTokenRows: TokenRow[];
	activityRows: ActivityRow[];
	allActivityRows: ActivityRow[];
	transactionDetails: Record<string, TransactionDetail>;
	positions: PortfolioPosition[];
	balanceHistory: BalanceHistoryPoint[];
	addLocalActivity: (row: ActivityRow, detail: TransactionDetail) => void;
};

const EMPTY_POSITIONS: PortfolioPosition[] = [];
const SOL_MINT = "So11111111111111111111111111111111111111112";
const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUPITER_TOKEN_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";
const LOYL_ICON_URL =
	"https://avatars.githubusercontent.com/u/210601628?s=200&v=4";
const SOL_ICON_URL =
	"https://coin-images.coingecko.com/coins/images/21629/large/solana.jpg";
const USDC_ICON_URL =
	"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png";

// In-memory local activity store (no localStorage dependency)
const localActivityStore = new Map<
	string,
	{ rows: ActivityRow[]; details: Record<string, TransactionDetail> }
>();

function resolveTokenIcon(position: PortfolioPosition): string {
	if (position.asset.imageUrl) {
		return position.asset.imageUrl;
	}
	if (position.asset.mint === LOYL_MINT) {
		return LOYL_ICON_URL;
	}
	return getTokenIconUrl(position.asset.symbol);
}

function formatUsd(value: number | null | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return "$0.00";
	}
	return value.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

function formatTokenBalance(balance: number): string {
	if (balance === 0) return "0";
	return balance.toLocaleString("en-US", {
		minimumFractionDigits: balance >= 1 ? 0 : 2,
		maximumFractionDigits: balance >= 1 ? 4 : 6,
	});
}

function formatSolAmount(lamports: number): string {
	return (lamports / 1_000_000_000).toLocaleString("en-US", {
		minimumFractionDigits: 0,
		maximumFractionDigits: 6,
	});
}

function formatTimestamp(timestamp: number | null): {
	date: string;
	time: string;
} {
	const date = timestamp ? new Date(timestamp) : new Date();
	return {
		date: date.toLocaleDateString("en-US", {
			month: "long",
			day: "numeric",
		}),
		time: date.toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		}),
	};
}

function resolvePositionByMint(
	positions: PortfolioPosition[],
	mint: string | undefined,
): PortfolioPosition | undefined {
	if (!mint) return undefined;
	return positions.find((position) => position.asset.mint === mint);
}

function getActivityDisplay(
	activity: WalletActivity,
	positions: PortfolioPosition[],
	solPriceUsd: number | null,
): {
	symbol: string;
	icon: string;
	amount: string;
	usdValue: number | null;
	counterparty: string;
} {
	switch (activity.type) {
		case "swap": {
			const fromPosition = resolvePositionByMint(
				positions,
				activity.fromToken.mint,
			);
			return {
				symbol: fromPosition?.asset.symbol ?? "SOL",
				icon: fromPosition
					? resolveTokenIcon(fromPosition)
					: getTokenIconUrl("SOL"),
				amount:
					activity.fromToken.amount ??
					formatSolAmount(activity.amountLamports),
				usdValue:
					typeof fromPosition?.priceUsd === "number"
						? parseFloat(activity.fromToken.amount) *
							fromPosition.priceUsd
						: null,
				counterparty: "Swap",
			};
		}
		case "token_transfer":
		case "secure":
		case "unshield": {
			const position = resolvePositionByMint(
				positions,
				activity.token.mint,
			);
			return {
				symbol: position?.asset.symbol ?? "TOKEN",
				icon: position
					? resolveTokenIcon(position)
					: "/hero-new/Wallet-Cover.png",
				amount: activity.token.amount,
				usdValue:
					typeof position?.priceUsd === "number"
						? parseFloat(activity.token.amount) *
							position.priceUsd
						: null,
				counterparty:
					activity.counterparty ??
					(activity.type === "secure"
						? "Secure"
						: activity.type === "unshield"
							? "Unshield"
							: activity.direction === "in"
								? "Unknown sender"
								: "Unknown recipient"),
			};
		}
		case "program_action": {
			if (activity.token) {
				const position = resolvePositionByMint(
					positions,
					activity.token.mint,
				);
				return {
					symbol: position?.asset.symbol ?? "TOKEN",
					icon: position
						? resolveTokenIcon(position)
						: "/hero-new/Wallet-Cover.png",
					amount: activity.token.amount,
					usdValue:
						typeof position?.priceUsd === "number"
							? parseFloat(activity.token.amount) *
								position.priceUsd
							: null,
					counterparty: activity.action,
				};
			}
			return {
				symbol: "SOL",
				icon: getTokenIconUrl("SOL"),
				amount: formatSolAmount(activity.amountLamports),
				usdValue:
					typeof solPriceUsd === "number"
						? (activity.amountLamports / 1_000_000_000) *
							solPriceUsd
						: null,
				counterparty: activity.action,
			};
		}
		case "sol_transfer":
		default:
			return {
				symbol: "SOL",
				icon: getTokenIconUrl("SOL"),
				amount: formatSolAmount(activity.amountLamports),
				usdValue:
					typeof solPriceUsd === "number"
						? (activity.amountLamports / 1_000_000_000) *
							solPriceUsd
						: null,
				counterparty:
					activity.counterparty ??
					(activity.direction === "in"
						? "Unknown sender"
						: "Unknown recipient"),
			};
	}
}

function getActivityUsdDelta(
	activity: WalletActivity,
	positions: PortfolioPosition[],
	solPriceUsd: number | null,
): number {
	const sign = activity.direction === "in" ? 1 : -1;

	switch (activity.type) {
		case "swap": {
			const fromPos = resolvePositionByMint(
				positions,
				activity.fromToken.mint,
			);
			const toPos = resolvePositionByMint(
				positions,
				activity.toToken.mint,
			);
			const fromUsd =
				typeof fromPos?.priceUsd === "number"
					? parseFloat(activity.fromToken.amount) *
						fromPos.priceUsd
					: 0;
			const toUsd =
				typeof toPos?.priceUsd === "number"
					? parseFloat(activity.toToken.amount) * toPos.priceUsd
					: 0;
			return toUsd - fromUsd;
		}
		case "token_transfer":
		case "secure":
		case "unshield": {
			const pos = resolvePositionByMint(
				positions,
				activity.token.mint,
			);
			if (typeof pos?.priceUsd === "number") {
				return (
					sign *
					parseFloat(activity.token.amount) *
					pos.priceUsd
				);
			}
			return 0;
		}
		case "program_action": {
			if (activity.token) {
				const pos = resolvePositionByMint(
					positions,
					activity.token.mint,
				);
				if (typeof pos?.priceUsd === "number") {
					return (
						sign *
						parseFloat(activity.token.amount) *
						pos.priceUsd
					);
				}
				return 0;
			}
			if (typeof solPriceUsd === "number") {
				return (
					sign *
					(activity.amountLamports / 1_000_000_000) *
					solPriceUsd
				);
			}
			return 0;
		}
		case "sol_transfer":
		default:
			if (typeof solPriceUsd === "number") {
				return (
					sign *
					(activity.amountLamports / 1_000_000_000) *
					solPriceUsd
				);
			}
			return 0;
	}
}

function mapActivityToRowAndDetail(
	activity: WalletActivity,
	positions: PortfolioPosition[],
	solPriceUsd: number | null,
): { row: ActivityRow; detail: TransactionDetail } {
	const display = getActivityDisplay(activity, positions, solPriceUsd);
	const isReceived = activity.direction === "in";
	const timestamp = formatTimestamp(activity.timestamp);
	const isShieldType =
		activity.type === "secure" || activity.type === "unshield";
	const amount = isShieldType
		? `${display.amount} ${display.symbol}`
		: `${isReceived ? "+" : "-"}${display.amount} ${display.symbol}`;

	const rowType: ActivityRow["type"] =
		activity.type === "secure"
			? "shielded"
			: activity.type === "unshield"
				? "unshielded"
				: isReceived
					? "received"
					: "sent";

	const row: ActivityRow = {
		id: activity.signature,
		type: rowType,
		counterparty: display.counterparty,
		amount,
		timestamp: timestamp.time,
		date: timestamp.date,
		icon:
			activity.type === "secure"
				? "/hero-new/Shield.png"
				: activity.type === "unshield"
					? "/hero-new/Unshield.svg"
					: display.icon,
		rawTimestamp: activity.timestamp ?? undefined,
	};

	return {
		row,
		detail: {
			activity: row,
			usdValue: formatUsd(display.usdValue),
			status: activity.status === "failed" ? "Failed" : "Completed",
			networkFee: `${formatSolAmount(activity.feeLamports)} SOL`,
			networkFeeUsd: formatUsd(
				typeof solPriceUsd === "number"
					? (activity.feeLamports / 1_000_000_000) * solPriceUsd
					: null,
			),
		},
	};
}

function mapPositionToTokenRow(position: PortfolioPosition): TokenRow {
	return {
		id: position.asset.mint,
		symbol: position.asset.symbol,
		price: formatUsd(position.priceUsd),
		amount: formatTokenBalance(position.totalBalance),
		value: formatUsd(position.totalValueUsd),
		icon: resolveTokenIcon(position),
	};
}

function mapPositionToSecuredTokenRow(
	position: PortfolioPosition,
): TokenRow {
	return {
		id: `${position.asset.mint}-secured`,
		symbol: position.asset.symbol,
		price: formatUsd(position.priceUsd),
		amount: formatTokenBalance(position.securedBalance),
		value: formatUsd(position.securedValueUsd),
		icon: resolveTokenIcon(position),
		isSecured: true,
	};
}

const ENV_LABELS: Record<string, string> = {
	mainnet: "Mainnet",
	devnet: "Devnet",
	localnet: "Localnet",
};

export function useWalletData(params: {
	publicKey: PublicKey | null;
	connected: boolean;
	client: SolanaWalletDataClient;
	solanaEnv: SolanaEnv;
}): WalletDesktopData {
	const { publicKey, connected, client, solanaEnv } = params;
	const walletAddress = publicKey?.toBase58() ?? null;
	const [portfolioSnapshot, setPortfolioSnapshot] =
		useState<PortfolioSnapshot | null>(null);
	const [activities, setActivities] = useState<WalletActivity[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [localRows, setLocalRows] = useState<ActivityRow[]>([]);
	const [localDetails, setLocalDetails] = useState<
		Record<string, TransactionDetail>
	>({});

	// Load local activity from in-memory store when wallet connects
	useEffect(() => {
		if (!walletAddress) {
			setLocalRows([]);
			setLocalDetails({});
			return;
		}
		const stored = localActivityStore.get(walletAddress);
		if (stored) {
			setLocalRows(stored.rows ?? []);
			setLocalDetails(stored.details ?? {});
		}
	}, [walletAddress]);

	const addLocalActivity = useCallback(
		(row: ActivityRow, detail: TransactionDetail) => {
			setLocalDetails((prevDetails) => {
				const nextDetails = { ...prevDetails, [row.id]: detail };
				setLocalRows((prevRows) => {
					const next = [row, ...prevRows];
					if (walletAddress) {
						localActivityStore.set(walletAddress, {
							rows: next,
							details: nextDetails,
						});
					}
					return next;
				});
				return nextDetails;
			});
		},
		[walletAddress],
	);

	useEffect(() => {
		if (!(connected && publicKey)) {
			setPortfolioSnapshot(null);
			setActivities([]);
			setIsLoading(false);
			return;
		}

		let cancelled = false;
		setIsLoading(true);

		void Promise.all([
			client.getPortfolio(publicKey),
			client.getActivity(publicKey, { limit: 25 }),
		])
			.then(([nextPortfolio, history]) => {
				if (cancelled) return;
				setPortfolioSnapshot(nextPortfolio);
				setActivities(history.activities);
				setIsLoading(false);
			})
			.catch((error) => {
				console.error(
					"Failed to load wallet desktop data",
					error,
				);
				if (!cancelled) setIsLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [client, connected, publicKey]);

	useEffect(() => {
		if (!(connected && publicKey)) return;

		let closed = false;
		let unsubscribePortfolio: (() => Promise<void>) | null = null;
		let unsubscribeActivity: (() => Promise<void>) | null = null;

		void client
			.subscribePortfolio(
				publicKey,
				(snapshot) => {
					if (!closed) setPortfolioSnapshot(snapshot);
				},
				{ emitInitial: false },
			)
			.then((unsubscribe) => {
				unsubscribePortfolio = unsubscribe;
			})
			.catch((error) => {
				console.error(
					"Failed to subscribe to wallet portfolio",
					error,
				);
			});

		void client
			.subscribeActivity(
				publicKey,
				(activity) => {
					if (closed) return;
					setActivities((currentActivities) => {
						const matchIndex = currentActivities.findIndex(
							(currentActivity) =>
								currentActivity.signature ===
								activity.signature,
						);
						if (matchIndex >= 0) {
							const nextActivities = [
								...currentActivities,
							];
							nextActivities[matchIndex] = {
								...currentActivities[matchIndex],
								...activity,
							};
							return nextActivities.sort(
								(left, right) =>
									(right.timestamp ?? 0) -
									(left.timestamp ?? 0),
							);
						}
						return [activity, ...currentActivities].sort(
							(left, right) =>
								(right.timestamp ?? 0) -
								(left.timestamp ?? 0),
						);
					});
				},
				{ emitInitial: false },
			)
			.then((unsubscribe) => {
				unsubscribeActivity = unsubscribe;
			})
			.catch((error) => {
				console.error(
					"Failed to subscribe to wallet activity",
					error,
				);
			});

		return () => {
			closed = true;
			if (unsubscribePortfolio) void unsubscribePortfolio();
			if (unsubscribeActivity) void unsubscribeActivity();
		};
	}, [client, connected, publicKey]);

	// Fetch LOYAL token price from Jupiter for the always-visible placeholder row
	const [loylPriceUsd, setLoylPriceUsd] = useState<number | null>(null);
	useEffect(() => {
		let cancelled = false;
		fetch(`${JUPITER_TOKEN_SEARCH_URL}?query=${LOYL_MINT}`)
			.then((res) => res.json())
			.then((tokens: { id: string; usdPrice?: number }[]) => {
				if (cancelled) return;
				const match = tokens.find((t) => t.id === LOYL_MINT);
				const price = match?.usdPrice;
				if (
					typeof price === "number" &&
					Number.isFinite(price) &&
					price > 0
				) {
					setLoylPriceUsd(price);
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	const positions =
		portfolioSnapshot?.positions ?? EMPTY_POSITIONS;
	const totals = portfolioSnapshot?.totals ?? {
		totalUsd: 0,
		totalSol: null,
		effectiveSolPriceUsd: null,
	};

	const allTokenRows = useMemo(() => {
		const rows: TokenRow[] = [];
		for (const position of positions) {
			if (position.totalBalance > 0) {
				rows.push(mapPositionToTokenRow(position));
			}
			if (position.securedBalance > 0) {
				rows.push(mapPositionToSecuredTokenRow(position));
			}
		}

		// Ensure SOL, LOYAL, USDC are always present (in that order at the top)
		const defaults: { mint: string; symbol: string; icon: string; price: number | null }[] = [
			{ mint: SOL_MINT, symbol: "SOL", icon: SOL_ICON_URL, price: null },
			{ mint: LOYL_MINT, symbol: "LOYAL", icon: LOYL_ICON_URL, price: loylPriceUsd },
			{ mint: USDC_MINT, symbol: "USDC", icon: USDC_ICON_URL, price: 1 },
		];

		for (let i = defaults.length - 1; i >= 0; i--) {
			const { mint, symbol, icon, price } = defaults[i];
			const existingIndex = rows.findIndex((r) => r.id === mint);
			if (existingIndex >= 0) {
				// Move to correct position if not already there
				if (existingIndex !== i) {
					const [row] = rows.splice(existingIndex, 1);
					rows.splice(Math.min(i, rows.length), 0, row);
				}
			} else {
				const pos = positions.find((p) => p.asset.mint === mint);
				const row: TokenRow = pos
					? mapPositionToTokenRow(pos)
					: {
							id: mint,
							symbol,
							price: price !== null ? formatUsd(price) : "$0.00",
							amount: "0",
							value: "$0.00",
							icon,
						};
				rows.splice(Math.min(i, rows.length), 0, row);
			}
		}

		return rows;
	}, [positions, loylPriceUsd]);

	// Enrich secured rows with Kamino APY
	const [apyByMint, setApyByMint] = useState<
		Record<string, number | null>
	>({});
	useEffect(() => {
		const securedMints = allTokenRows
			.filter((r) => r.isSecured && r.id)
			.map((r) => r.id!.replace(/-secured$/, ""));
		if (securedMints.length === 0) return;

		let cancelled = false;
		Promise.all(
			securedMints.map(async (mint) => {
				const apyBps = await getCachedKaminoLendingApyBps({
					solanaEnv,
					mint,
				});
				return [mint, apyBps] as const;
			}),
		).then((results) => {
			if (cancelled) return;
			const next: Record<string, number | null> = {};
			for (const [mint, apyBps] of results) {
				if (apyBps !== null) next[mint] = apyBps;
			}
			if (Object.keys(next).length > 0) setApyByMint(next);
		});

		return () => {
			cancelled = true;
		};
	}, [allTokenRows, solanaEnv]);

	const enrichedTokenRows = useMemo(() => {
		if (Object.keys(apyByMint).length === 0) return allTokenRows;
		return allTokenRows.map((row) => {
			if (!row.isSecured || !row.id) return row;
			const mint = row.id.replace(/-secured$/, "");
			const apyBps = apyByMint[mint];
			return apyBps != null ? { ...row, apyBps } : row;
		});
	}, [allTokenRows, apyByMint]);

	const activityData = useMemo(() => {
		const details: Record<string, TransactionDetail> = {};
		const SHIELD_PLUMBING_ACTIONS = new Set([
			"initialize_deposit",
			"create_permission",
			"delegate",
			"undelegate",
			"initialize_username_deposit",
			"create_username_permission",
			"delegate_username_deposit",
			"undelegate_username_deposit",
		]);
		const rows = activities
			.filter(
				(a) =>
					!(
						a.type === "program_action" &&
						SHIELD_PLUMBING_ACTIONS.has(a.action)
					),
			)
			.map((activity) => {
				const mapped = mapActivityToRowAndDetail(
					activity,
					positions,
					totals.effectiveSolPriceUsd,
				);
				details[mapped.row.id] = mapped.detail;
				return mapped.row;
			});
		return { rows, details };
	}, [activities, positions, totals.effectiveSolPriceUsd]);

	const mergedActivityData = useMemo(() => {
		const onChainIds = new Set(activityData.rows.map((r) => r.id));
		const uniqueLocalRows = localRows.filter(
			(r) => !onChainIds.has(r.id),
		);
		const rows = [...uniqueLocalRows, ...activityData.rows].sort(
			(a, b) => (b.rawTimestamp ?? 0) - (a.rawTimestamp ?? 0),
		);
		const details = { ...activityData.details, ...localDetails };
		return { rows, details };
	}, [activityData, localRows, localDetails]);

	const balanceHistoryRef = useRef<BalanceHistoryPoint[]>([]);
	const balanceHistoryKeyRef = useRef<string | null>(null);

	const balanceHistory = useMemo((): BalanceHistoryPoint[] => {
		if (activities.length === 0 || totals.totalUsd <= 0) return [];

		const key = walletAddress ?? "";
		if (
			balanceHistoryKeyRef.current === key &&
			balanceHistoryRef.current.length > 1
		) {
			return balanceHistoryRef.current;
		}

		const now = Date.now();
		const sorted = [...activities]
			.filter((a) => a.timestamp !== null)
			.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

		if (sorted.length === 0)
			return [{ timestamp: now, valueUsd: totals.totalUsd }];

		const points: BalanceHistoryPoint[] = [
			{ timestamp: now, valueUsd: totals.totalUsd },
		];
		let runningUsd = totals.totalUsd;

		for (const activity of sorted) {
			const delta = getActivityUsdDelta(
				activity,
				positions,
				totals.effectiveSolPriceUsd,
			);
			runningUsd -= delta;
			points.push({
				timestamp: activity.timestamp as number,
				valueUsd: Math.max(0, runningUsd),
			});
		}

		const result = points.reverse();
		balanceHistoryRef.current = result;
		balanceHistoryKeyRef.current = key;
		return result;
	}, [
		activities,
		positions,
		totals.totalUsd,
		totals.effectiveSolPriceUsd,
		walletAddress,
	]);

	const formattedBalance = formatUsd(totals.totalUsd);
	const balanceParts = formattedBalance.split(".");
	const walletLabel = walletAddress
		? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)} · ${
				ENV_LABELS[solanaEnv] ?? "Mainnet"
			}`
		: "No account";

	return {
		walletAddress,
		isConnected: Boolean(connected && walletAddress),
		isLoading,
		balanceWhole: balanceParts[0] ?? "$0",
		balanceFraction: balanceParts[1] ? `.${balanceParts[1]}` : "",
		balanceSolLabel:
			totals.totalSol === null
				? "0 SOL"
				: `${totals.totalSol.toLocaleString("en-US", {
						minimumFractionDigits: 0,
						maximumFractionDigits: 5,
					})} SOL`,
		walletLabel,
		tokenRows: enrichedTokenRows.slice(0, 3),
		allTokenRows: enrichedTokenRows,
		activityRows: mergedActivityData.rows.slice(0, 5),
		allActivityRows: mergedActivityData.rows,
		transactionDetails: mergedActivityData.details,
		positions,
		balanceHistory,
		addLocalActivity,
	};
}
