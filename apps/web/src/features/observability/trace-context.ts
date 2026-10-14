export type JourneyTraceContext = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
};

export function isTraceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{32}$/.test(value) &&
    !/^0+$/.test(value)
  );
}

export function isSpanId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{16}$/.test(value) &&
    !/^0+$/.test(value)
  );
}

export function parseJourneyTraceparent(
  value: string | null
): JourneyTraceContext | undefined {
  const match = value?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-0[01]$/);
  if (!match || !isTraceId(match[1]) || !isSpanId(match[2])) return undefined;
  return { traceId: match[1], spanId: match[2] };
}

export function journeyTraceparent(context: JourneyTraceContext): string {
  return `00-${context.traceId}-${context.spanId}-01`;
}
