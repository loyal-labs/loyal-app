import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { SWAP_ERRORS } from "@/lib/jupiter/constants";
import {
  convertFromBaseUnits,
  convertToBaseUnits,
  fetchOrder,
} from "@/lib/jupiter/server";

type OrderRequestBody = {
  fromMint: string;
  toMint: string;
  fromAmount: number;
  fromDecimals: number;
  toDecimals: number;
  userPublicKey: string;
};

function isValidPublicKey(key: string): boolean {
  try {
    new PublicKey(key);
    return true;
  } catch {
    return false;
  }
}

function isValidDecimals(decimals: unknown): decimals is number {
  return (
    typeof decimals === "number" &&
    Number.isInteger(decimals) &&
    decimals >= 0 &&
    decimals <= 18
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.arrayBuffer();
    if (!body || body.byteLength === 0) {
      return NextResponse.json(
        { error: "Request body is required" },
        { status: 400 }
      );
    }

    const bodyString = new TextDecoder().decode(body);
    const {
      fromMint,
      toMint,
      fromAmount,
      fromDecimals,
      toDecimals,
      userPublicKey,
    } = JSON.parse(bodyString) as OrderRequestBody;

    if (!fromMint || !toMint || !fromAmount || !userPublicKey) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!isValidPublicKey(fromMint) || !isValidPublicKey(toMint)) {
      return NextResponse.json(
        { error: "Invalid token mint address" },
        { status: 400 }
      );
    }

    if (!isValidPublicKey(userPublicKey)) {
      return NextResponse.json(
        { error: "Invalid user public key" },
        { status: 400 }
      );
    }

    if (!isValidDecimals(fromDecimals) || !isValidDecimals(toDecimals)) {
      return NextResponse.json(
        { error: "Invalid token decimals" },
        { status: 400 }
      );
    }

    if (fromAmount <= 0) {
      return NextResponse.json(
        { error: "Amount must be greater than 0" },
        { status: 400 }
      );
    }

    const amountInBaseUnits = convertToBaseUnits(fromAmount, fromDecimals);

    const orderResponse = await fetchOrder({
      inputMint: fromMint,
      outputMint: toMint,
      amount: amountInBaseUnits,
      taker: userPublicKey,
    });

    const expectedOutAmount = convertFromBaseUnits(
      orderResponse.outAmount,
      toDecimals
    );
    const priceImpactPct = parseFloat(orderResponse.priceImpactPct);

    return NextResponse.json({
      transaction: orderResponse.transaction,
      requestId: orderResponse.requestId,
      expectedOutAmount,
      priceImpactPct,
      inAmount: fromAmount,
      outAmount: expectedOutAmount,
      gasless: orderResponse.gasless,
      swapType: orderResponse.swapType,
    });
  } catch (error) {
    console.error("[jupiter][order] Error:", error);

    if (error instanceof Error) {
      if (error.message.includes("HTTP")) {
        return NextResponse.json(
          { error: SWAP_ERRORS.QUOTE_FAILED },
          { status: 502 }
        );
      }
      if (error.message === SWAP_ERRORS.MISSING_API_KEY) {
        return NextResponse.json(
          { error: SWAP_ERRORS.MISSING_API_KEY },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { error: SWAP_ERRORS.QUOTE_FAILED },
      { status: 500 }
    );
  }
}
