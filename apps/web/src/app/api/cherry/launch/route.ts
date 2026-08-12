import { attestCherryLaunch } from "@/features/cherry/server/launch-attestation";

export async function POST(request: Request): Promise<Response> {
  return attestCherryLaunch(request);
}
