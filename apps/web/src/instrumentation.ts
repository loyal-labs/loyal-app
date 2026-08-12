import type { Instrumentation } from "next";

import { reportServerError } from "@/features/observability/server";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  await reportServerError(error, {
    method: request.method,
    operation: "next.request.error",
    pathname: context.routePath ?? request.path,
  });
};
