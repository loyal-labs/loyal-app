import { NextResponse } from "next/server";

import { SWAP_ERRORS } from "@/lib/jupiter/constants";
import { executeOrder } from "@/lib/jupiter/server";

type ExecuteRequestBody = {
  signedTransaction: string;
  requestId: string;
};

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
    const { signedTransaction, requestId } = JSON.parse(
      bodyString
    ) as ExecuteRequestBody;

    if (!signedTransaction || !requestId) {
      return NextResponse.json(
        { error: "Missing signedTransaction or requestId" },
        { status: 400 }
      );
    }

    const result = await executeOrder({ signedTransaction, requestId });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[jupiter][execute] Error:", error);

    return NextResponse.json(
      { error: SWAP_ERRORS.EXECUTION_FAILED },
      { status: 500 }
    );
  }
}
