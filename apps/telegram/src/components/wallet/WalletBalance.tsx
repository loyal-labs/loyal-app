"use client";

import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Badge, Cell, Info } from "@telegram-apps/telegram-ui";
import { useEffect, useState } from "react";

import { fetchSolUsdPrice } from "@/lib/solana/fetch-sol-price";
import {
  getWalletBalance,
  getWalletPublicKey,
} from "@/lib/solana/wallet/wallet-details";

type WalletBalanceData = {
  lamports: number | null;
  publicKey: string | null;
};

const INITIAL_DATA: WalletBalanceData = {
  lamports: null,
  publicKey: null,
};

const formatBalance = (lamports: number | null): string => {
  if (lamports === null) return "—";

  const sol = lamports / LAMPORTS_PER_SOL;
  return `${sol.toFixed(4)} SOL`;
};

const formatUsdValue = (
  lamports: number | null,
  solPriceUsd: number | null
): string => {
  if (lamports === null || solPriceUsd === null) return "—";

  const sol = lamports / LAMPORTS_PER_SOL;
  const usd = sol * solPriceUsd;

  return `$${usd.toFixed(2)}`;
};

export default function WalletBalance() {
  const [data, setData] = useState<WalletBalanceData>(INITIAL_DATA);
  const [isLoading, setIsLoading] = useState(true);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const [isPriceLoading, setIsPriceLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const [publicKey, lamports] = await Promise.all([
          getWalletPublicKey(),
          getWalletBalance(),
        ]);

        if (!isMounted) return;
        setData({
          lamports,
          publicKey: publicKey.toBase58(),
        });
      } catch (error) {
        console.error("Failed to load wallet balance", error);
        if (!isMounted) return;
        setData(INITIAL_DATA);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadPrice = async () => {
      try {
        const price = await fetchSolUsdPrice();
        if (!isMounted) return;
        setSolPriceUsd(price);
      } catch (error) {
        console.error("Failed to fetch SOL price", error);
        if (!isMounted) return;
        setSolPriceUsd(null);
      } finally {
        if (isMounted) {
          setIsPriceLoading(false);
        }
      }
    };

    void loadPrice();

    return () => {
      isMounted = false;
    };
  }, []);

  const balanceDisplay = formatBalance(data.lamports);
  const usdDisplay = formatUsdValue(data.lamports, solPriceUsd);
  const subtitle = isLoading || isPriceLoading ? "Loading…" : usdDisplay;

  return (
    <Cell
      after={
        <Info subtitle={subtitle} type="text">
          {isLoading ? "…" : balanceDisplay}
        </Info>
      }
      description={
        data.publicKey ? `${data.publicKey.slice(0, 4)}…${data.publicKey.slice(-4)}` : undefined
      }
      interactiveAnimation="opacity"
      titleBadge={<Badge type="dot" />}
    >
      Balance
    </Cell>
  );
}
