function splitPath(value: string): string[] {
  return value
    .trim()
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function assertSafeSegments(segments: string[], fieldName: string): void {
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new Error(`${fieldName} contains an invalid path segment`);
    }
  }
}

export function normalizeObjectPath(value: string, fieldName: string): string {
  const segments = splitPath(value);
  if (segments.length === 0) {
    throw new Error(`${fieldName} is required`);
  }

  assertSafeSegments(segments, fieldName);
  return segments.join("/");
}

export function joinObjectPaths(
  prefix: string | undefined,
  key: string,
  keyFieldName: string
): string {
  const normalizedKey = normalizeObjectPath(key, keyFieldName);
  if (!prefix) return normalizedKey;

  const normalizedPrefix = normalizeObjectPath(prefix, "prefix");
  return `${normalizedPrefix}/${normalizedKey}`;
}

export function encodeObjectPath(value: string): string {
  const segments = normalizeObjectPath(value, "path").split("/");
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}
