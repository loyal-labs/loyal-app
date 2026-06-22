import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useEarnActivity } from "@/hooks/wallet/useEarnActivity";
import { useWalletTransactions } from "@/hooks/wallet/useWalletTransactions";
import type { EarnTransactionItem } from "@/lib/solana/earn/earn-api";
import { earnTransactionTimestampMs } from "@/lib/solana/earn/earn-tx-display";
import { useWallet } from "@/lib/wallet/wallet-provider";
import type { Transaction } from "@/types/wallet";

import {
  type ActivitySection,
  getActivityLastSeen,
  setActivityLastSeen,
} from "./activity-unread";

type ActivityContextValue = {
  walletAddress: string | null;
  walletTransactions: Transaction[];
  isFetchingTransactions: boolean;
  loadWalletTransactions: (options?: { force?: boolean }) => Promise<void>;
  earnTransactions: EarnTransactionItem[];
  isFetchingEarn: boolean;
  refreshEarnTransactions: () => Promise<void>;
  /** New wallet activity since the Wallet section was last viewed. */
  walletUnread: boolean;
  /** New Earn activity since the Earn section was last viewed. */
  earnUnread: boolean;
  /** Any section has new activity — drives the bottom-nav dot. */
  anyUnread: boolean;
  /** Mark a section as seen, clearing its dot. */
  markSeen: (section: ActivitySection) => void;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

// Owns the wallet + Earn activity feeds app-wide so the bottom-nav dot stays
// live even before the Activity screen is first opened, and so the screen and
// the nav share a single fetch. Mounted once around the tab navigator.
export function ActivityProvider({ children }: { children: ReactNode }) {
  const { publicKey } = useWallet();
  const { walletTransactions, isFetchingTransactions, loadWalletTransactions } =
    useWalletTransactions(publicKey);
  const {
    earnTransactions,
    isLoading: isFetchingEarn,
    refresh: refreshEarnTransactions,
  } = useEarnActivity(publicKey);

  const newestWalletTs = useMemo(() => {
    let newest = 0;
    for (const tx of walletTransactions) {
      if (tx.timestamp > newest) newest = tx.timestamp;
    }
    return newest;
  }, [walletTransactions]);

  const newestEarnTs = useMemo(() => {
    let newest = 0;
    for (const tx of earnTransactions) {
      const ts = earnTransactionTimestampMs(tx);
      if (ts > newest) newest = ts;
    }
    return newest;
  }, [earnTransactions]);

  const [seenWallet, setSeenWallet] = useState<number | undefined>(() =>
    getActivityLastSeen("wallet"),
  );
  const [seenEarn, setSeenEarn] = useState<number | undefined>(() =>
    getActivityLastSeen("earn"),
  );

  // First ever launch: seed last-seen to the newest known item so the user's
  // pre-existing history doesn't light up the dot. Only new items afterwards do.
  useEffect(() => {
    if (newestWalletTs <= 0 || seenWallet !== undefined) return;
    setActivityLastSeen("wallet", newestWalletTs);
    setSeenWallet(newestWalletTs);
  }, [newestWalletTs, seenWallet]);

  useEffect(() => {
    if (newestEarnTs <= 0 || seenEarn !== undefined) return;
    setActivityLastSeen("earn", newestEarnTs);
    setSeenEarn(newestEarnTs);
  }, [newestEarnTs, seenEarn]);

  const markSeen = useCallback(
    (section: ActivitySection) => {
      // Skip until items have loaded — recording a 0 baseline would make every
      // real transaction that arrives afterwards look "new".
      if (section === "wallet" && newestWalletTs > 0) {
        setActivityLastSeen("wallet", newestWalletTs);
        setSeenWallet(newestWalletTs);
      }
      if (section === "earn" && newestEarnTs > 0) {
        setActivityLastSeen("earn", newestEarnTs);
        setSeenEarn(newestEarnTs);
      }
    },
    [newestWalletTs, newestEarnTs],
  );

  const walletUnread = seenWallet !== undefined && newestWalletTs > seenWallet;
  const earnUnread = seenEarn !== undefined && newestEarnTs > seenEarn;

  const value = useMemo<ActivityContextValue>(
    () => ({
      walletAddress: publicKey,
      walletTransactions,
      isFetchingTransactions,
      loadWalletTransactions,
      earnTransactions,
      isFetchingEarn,
      refreshEarnTransactions,
      walletUnread,
      earnUnread,
      anyUnread: walletUnread || earnUnread,
      markSeen,
    }),
    [
      publicKey,
      walletTransactions,
      isFetchingTransactions,
      loadWalletTransactions,
      earnTransactions,
      isFetchingEarn,
      refreshEarnTransactions,
      walletUnread,
      earnUnread,
      markSeen,
    ],
  );

  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivity(): ActivityContextValue {
  const ctx = useContext(ActivityContext);
  if (!ctx) {
    throw new Error("useActivity must be used within an ActivityProvider");
  }
  return ctx;
}
