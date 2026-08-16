import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useCallback, useMemo, useRef, useState } from "react";

import { ActivityFeed } from "@/components/wallet/ActivityFeed";
import { TransactionDetailsSheet } from "@/components/wallet/TransactionDetailsSheet";
import { useTokenDetails } from "@/hooks/wallet/useTokenDetails";
import { useTokenHoldings } from "@/hooks/wallet/useTokenHoldings";
import {
  LOYAL_TOKEN_MINT,
  NATIVE_SOL_MINT,
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
} from "@/lib/solana/constants";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import type { Transaction } from "@/types/wallet";

import { useActivity } from "../model/ActivityProvider";

// The Wallet section of the Activity screen: the full wallet transactions list,
// the same rows the wallet page used to show, now uncapped on its own tab.
export function WalletActivityList() {
  const { walletAddress, walletTransactions, isFetchingTransactions } =
    useActivity();
  const { tokenHoldings } = useTokenHoldings(walletAddress);

  // Resolve token icons/symbols for held tokens plus the SOL/LOYAL/USDC
  // prefills, mirroring the wallet page so rows never fall back to raw symbols.
  const tokenDetailMints = useMemo(() => {
    const mints = new Set<string>();
    mints.add(NATIVE_SOL_MINT);
    mints.add(LOYAL_TOKEN_MINT);
    mints.add(
      getSolanaEnv() === "mainnet"
        ? SOLANA_USDC_MINT_MAINNET
        : SOLANA_USDC_MINT_DEVNET,
    );
    for (const holding of tokenHoldings) mints.add(holding.mint);
    return Array.from(mints);
  }, [tokenHoldings]);
  const tokenDetailsByMint = useTokenDetails(tokenDetailMints);

  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const txDetailsSheetRef = useRef<BottomSheetModal>(null);

  const handleTransactionPress = useCallback((transaction: Transaction) => {
    setSelectedTransaction(transaction);
    txDetailsSheetRef.current?.present();
  }, []);

  return (
    <>
      <ActivityFeed
        transactions={walletTransactions}
        tokenHoldings={tokenHoldings}
        tokenDetailsByMint={tokenDetailsByMint}
        isLoading={isFetchingTransactions}
        onTransactionPress={handleTransactionPress}
        onShowAll={() => {}}
        maxItems={walletTransactions.length}
        hideHeading
      />

      <TransactionDetailsSheet
        ref={txDetailsSheetRef}
        transaction={selectedTransaction}
        tokenHoldings={tokenHoldings}
        tokenDetailsByMint={tokenDetailsByMint}
      />
    </>
  );
}
