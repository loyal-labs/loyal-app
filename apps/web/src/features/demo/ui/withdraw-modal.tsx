"use client";

import {
  useSignAndSendTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { CircleX, Info, X } from "lucide-react";
import Image from "next/image";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";

import { earnToast } from "@/components/wallet-workspace/facelift/earn-toast";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { usePublicEnv } from "@/contexts/public-env-context";
import { cn } from "@/lib/utils";

const USDC_DECIMALS = 6;

function parseAddress(value: string): PublicKey | null {
  try {
    return new PublicKey(value.trim());
  } catch {
    return null;
  }
}

// Real USDC transfer out of the Privy embedded wallet. Privy shows one
// approval; the wallet pays the network fee.
export function WithdrawModal({
  open,
  onOpenChange,
  from,
  mint,
  available,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: string;
  mint: PublicKey;
  available: number;
  onSent: (signature: string) => void;
}) {
  const { solanaEnv, solanaRpcEndpoint } = usePublicEnv();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dest = parseAddress(to);
  const short = dest ? `${to.trim().slice(0, 4)}…${to.trim().slice(-4)}` : "";

  const send = async () => {
    const wallet = wallets.find((w) => w.address === from);
    if (!(dest && wallet)) return;
    setBusy(true);
    setError(null);
    try {
      const owner = new PublicKey(from);
      const connection = new Connection(solanaRpcEndpoint, "confirmed");
      const fromAta = getAssociatedTokenAddressSync(mint, owner);
      const toAta = getAssociatedTokenAddressSync(mint, dest, true);
      const { blockhash } = await connection.getLatestBlockhash();
      const message = new TransactionMessage({
        payerKey: owner,
        recentBlockhash: blockhash,
        instructions: [
          createAssociatedTokenAccountIdempotentInstruction(
            owner,
            toAta,
            dest,
            mint
          ),
          createTransferInstruction(
            fromAta,
            toAta,
            owner,
            Math.round(available * 10 ** USDC_DECIMALS)
          ),
        ],
      }).compileToV0Message();
      const { signature } = await signAndSendTransaction({
        transaction: new VersionedTransaction(message).serialize(),
        wallet,
        chain: solanaEnv === "devnet" ? "solana:devnet" : "solana:mainnet",
      });
      onSent(bs58.encode(signature));
      onOpenChange(false);
      setTo("");
      earnToast.success("Withdrawal sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      earnToast.error("Withdrawal failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogPrimitive.Root onOpenChange={onOpenChange} open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="t-modal-overlay fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        {/* Radix sets data-state; globals.css t-modal keyframes scale the
            surface from 0.96, so it is centered by the flex wrapper, not a
            transform of its own. */}
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <DialogPrimitive.Content className="t-modal t-modal-center dark pointer-events-auto flex h-[420px] w-full max-w-[296px] flex-col rounded-[24px] bg-[#1d1b20] p-4 font-sans text-[#e1e3e6] outline-none">
            <div className="flex items-center justify-between">
              <DialogPrimitive.Title className="font-semibold text-[17px] leading-6">
                Withdraw
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="Close"
                className="text-[#97959a] hover:text-[#e1e3e6]"
              >
                <X size={20} />
              </DialogPrimitive.Close>
            </div>
            <p className="mt-6 text-[#97959a] text-[13px] leading-4">Amount</p>
            <p className="font-semibold text-[28px] leading-8">
              ${available.toFixed(2)}
            </p>
            <DialogPrimitive.Description className="mt-4 flex gap-1.5 text-[#97959a] text-[12px] leading-4">
              <Info className="mt-0.5 shrink-0" size={12} />
              Privy asks for one approval. Only canonical USDC is sent; this
              embedded wallet pays the Solana network fee.
            </DialogPrimitive.Description>
            <div className="mt-auto flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Image
                  alt="USDC"
                  className="size-8 rounded-full"
                  height={32}
                  src="/demo/usdc.png"
                  width={32}
                />
                <div className="flex-1">
                  <p className="text-[#97959a] text-[12px] leading-4">
                    Available
                  </p>
                  <p className="text-[15px] leading-5">
                    {available.toFixed(2)} USDC
                  </p>
                </div>
                <span className="rounded-full bg-white/[0.08] px-3 py-1.5 font-medium text-[12px]">
                  MAX
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-white/[0.08] text-[#97959a]">
                  <Image
                    alt=""
                    className="size-4 opacity-60"
                    height={16}
                    src="/demo/usdc.png"
                    width={16}
                  />
                </span>
                <div className="flex-1">
                  <p className="text-[#97959a] text-[12px] leading-4">
                    Destination Solana address
                  </p>
                  {dest ? (
                    <p className="text-[15px] leading-5">{short}</p>
                  ) : (
                    <input
                      aria-label="Destination Solana address"
                      className="w-full bg-transparent text-[15px] leading-5 outline-none placeholder:text-[#636067]"
                      onChange={(e) => setTo(e.target.value)}
                      placeholder="Enter address"
                      value={to}
                    />
                  )}
                </div>
                {dest ? (
                  <button
                    aria-label="Clear address"
                    className="text-[#97959a] hover:text-[#e1e3e6]"
                    onClick={() => setTo("")}
                    type="button"
                  >
                    <CircleX size={18} />
                  </button>
                ) : (
                  <button
                    className="rounded-full bg-white/[0.08] px-3 py-1.5 font-medium text-[12px]"
                    onClick={() =>
                      void navigator.clipboard.readText().then(setTo)
                    }
                    type="button"
                  >
                    Paste
                  </button>
                )}
              </div>
              {error ? (
                <p className="text-[#ff5050] text-[12px] leading-4">{error}</p>
              ) : null}
              <button
                className={cn(
                  "h-11 rounded-full font-medium text-[15px] transition-[background-color,color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]",
                  dest
                    ? "bg-[#e1e3e6] text-[#0f0d13] hover:bg-white"
                    : "bg-[rgba(249,54,60,0.14)] text-[#ff5050]"
                )}
                disabled={!dest || busy}
                onClick={() => void send()}
                type="button"
              >
                <TextSwap
                  text={busy ? "Sending…" : dest ? "Withdraw" : "Enter address"}
                />
              </button>
            </div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
