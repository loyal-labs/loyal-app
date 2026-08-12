import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getCloudflareCdnUrlClientFromEnv } from "@/lib/core/cdn-url";
import { serverEnv } from "@/lib/core/config/server";
import { getCloudflareR2UploadClientFromEnv } from "@/lib/core/r2-upload";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

function authorize(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return false;
  }
  const presented = header.slice("Bearer ".length).trim();
  if (!presented) return false;

  const expected = serverEnv.libraryUploadToken;
  if (presented.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorize(request)) {
    return unauthorized();
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest("Expected multipart/form-data body");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return badRequest("`file` field is required");
  }

  const extension = ALLOWED_CONTENT_TYPES[file.type];
  if (!extension) {
    return badRequest(
      "Unsupported content type; allowed: image/png, image/jpeg, image/webp"
    );
  }

  if (file.size <= 0) {
    return badRequest("Uploaded file is empty");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "File exceeds 5MB limit" },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `library/${randomUUID()}.${extension}`;

  const r2 = getCloudflareR2UploadClientFromEnv();
  await r2.uploadImage({
    key,
    body: buffer,
    contentType: file.type,
  });

  // R2 client and CDN client both apply CLOUDFLARE_R2_UPLOAD_PREFIX.
  // Pass the original (unprefixed) key to the CDN resolver to avoid a double prefix.
  const cdn = getCloudflareCdnUrlClientFromEnv();
  const url = cdn.resolveUrl({ key });

  return NextResponse.json({ url });
}
