import { NextResponse } from "next/server";

import { checkChatParticipation } from "@/lib/telegram/bot-api/check-chat-participation";
import { CHANNEL_USERNAME } from "@/lib/telegram/bot-api/constants";
import { createValidationBytesFromRawInitData } from "@/lib/telegram/mini-app/init-data-transform";
import { cleanInitData } from "@/lib/telegram/mini-app/init-data-transform";
import { verifyInitData } from "@/lib/telegram/mini-app/verify-init-data";

const textDecoder = new TextDecoder();

export async function POST(req: Request) {
  try {
    const body = await req.arrayBuffer();
    if (!body || body.byteLength === 0) {
      return NextResponse.json(
        { error: "initData bytes are required" },
        { status: 400 }
      );
    }

    const initData = textDecoder.decode(body);
    if (!initData) {
      return NextResponse.json({ error: "initData is empty" }, { status: 400 });
    }

    let validationBytes: Uint8Array;
    let signatureBytes: Uint8Array;
    try {
      ({ validationBytes, signatureBytes } =
        createValidationBytesFromRawInitData(initData));
    } catch (error) {
      console.error("[telegram][verify][join] failed to parse initData", error);
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

    const cleanData = cleanInitData(initData);
    const user = JSON.parse(cleanData.user as string) as { id: number };
    const isParticipant = await checkChatParticipation(
      CHANNEL_USERNAME,
      user.id
    );

    if (!isParticipant) {
      return NextResponse.json(
        { error: "User is not a participant of the channel" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[telegram][verify][join] failed to verify join", error);
    return NextResponse.json(
      { error: "Failed to verify join" },
      { status: 500 }
    );
  }
}
