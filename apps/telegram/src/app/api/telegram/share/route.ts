import { NextResponse } from "next/server";

import { resolveEndpoint } from "@/lib/core/api";
import { prepareInlineMessage } from "@/lib/telegram/bot-api/prepared-inline-message";
import { createValidationBytesFromRawInitData } from "@/lib/telegram/mini-app/init-data-transform";
import { cleanInitData } from "@/lib/telegram/mini-app/init-data-transform";
import { verifyInitData } from "@/lib/telegram/mini-app/verify-init-data";

const getPhotoUrl = (
  requestUrl: string,
  senderUsername: string,
  receiverUsername: string,
  solAmount: number,
  usdAmount: number,
  isSecure?: boolean
) => {
  const endpoint = resolveEndpoint("/api/og/share");
  const url = new URL(endpoint, requestUrl);
  url.searchParams.set("sender", senderUsername);
  url.searchParams.set("receiver", receiverUsername);
  url.searchParams.set("solAmount", solAmount.toString());
  url.searchParams.set("usdAmount", usdAmount.toString());
  if (isSecure) url.searchParams.set("secure", "1");
  return url.toString();
};

export async function POST(req: Request) {
  try {
    const body = await req.arrayBuffer();
    if (!body || body.byteLength === 0) {
      return NextResponse.json(
        { error: "initData bytes are required" },
        { status: 400 }
      );
    }

    const bodyString = new TextDecoder().decode(body);
    const bodyJson = JSON.parse(bodyString);
    const { rawInitData, receiverUsername, solAmount, usdAmount, isSecure } =
      bodyJson;
    if (!rawInitData || !receiverUsername || !solAmount || !usdAmount) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    let validationBytes: Uint8Array;
    let signatureBytes: Uint8Array;
    try {
      ({ validationBytes, signatureBytes } =
        createValidationBytesFromRawInitData(rawInitData));
    } catch (error) {
      console.error("[telegram][share] failed to parse initData", error);
      return NextResponse.json(
        { error: "Invalid initData payload" },
        { status: 400 }
      );
    }

    const isValid = await verifyInitData(validationBytes, signatureBytes);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid Telegram init data" },
        { status: 401 }
      );
    }

    const cleanData = cleanInitData(rawInitData);
    const user = JSON.parse(cleanData.user as string) as {
      id: number;
      username?: string;
    };
    let senderUsername: string;

    if (!user.username) {
      senderUsername = "@unknown";
    } else {
      senderUsername = `${user.username}`;
    }

    const userId = user.id;
    const photoUrl = getPhotoUrl(
      req.url,
      senderUsername,
      receiverUsername,
      solAmount,
      usdAmount,
      isSecure
    );

    const preparedInlineMessage = await prepareInlineMessage(
      userId,
      photoUrl,
      senderUsername,
      receiverUsername,
      solAmount,
      isSecure
    );

    return NextResponse.json({ msgId: preparedInlineMessage.id });
  } catch (error) {
    console.error("[telegram][share] failed to share", error);
    return NextResponse.json({ error: "Failed to share" }, { status: 500 });
  }
}
