export const CONSOLE_FORWARD_SOURCE = "loyal-webview-console";

export type WebViewConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export type WebViewConsoleMessage = {
  source: typeof CONSOLE_FORWARD_SOURCE;
  level: WebViewConsoleLevel;
  args: unknown[];
};

export function buildConsoleForwardScript(): string {
  return `(() => {
  if (window.__loyalConsoleForwardInstalled) return;
  window.__loyalConsoleForwardInstalled = true;

  const source = ${JSON.stringify(CONSOLE_FORWARD_SOURCE)};

  function serializeArg(arg) {
    if (arg instanceof Error) {
      return {
        __error: true,
        name: arg.name,
        message: arg.message,
        stack: arg.stack,
      };
    }
    if (arg === undefined) return "undefined";
    if (arg === null) return null;
    if (typeof arg === "function") return "[Function " + (arg.name || "anonymous") + "]";
    if (typeof arg === "object") {
      try {
        return JSON.parse(JSON.stringify(arg));
      } catch (e) {
        try { return String(arg); } catch (_) { return "[Unserializable object]"; }
      }
    }
    return arg;
  }

  function send(level, args) {
    try {
      const serialized = Array.prototype.map.call(args, serializeArg);
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ source: source, level: level, args: serialized })
      );
    } catch (e) {}
  }

  const levels = ["log", "info", "warn", "error", "debug"];
  for (const level of levels) {
    const original = console[level] ? console[level].bind(console) : null;
    console[level] = function () {
      send(level, arguments);
      if (original) {
        try { original.apply(null, arguments); } catch (e) {}
      }
    };
  }

  window.addEventListener("error", function (event) {
    send("error", [
      "[window.error]",
      event.message || String(event),
      (event.filename || "?") + ":" + (event.lineno || 0) + ":" + (event.colno || 0),
      event.error && event.error.stack ? event.error.stack : null,
    ]);
  });

  window.addEventListener("unhandledrejection", function (event) {
    const reason = event.reason;
    send("error", [
      "[unhandledrejection]",
      reason instanceof Error ? reason.message : String(reason),
      reason instanceof Error ? reason.stack : null,
    ]);
  });
})();`;
}

function formatArg(arg: unknown): string {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "string") return arg;
  if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
  if (
    typeof arg === "object" &&
    arg !== null &&
    "__error" in arg &&
    (arg as { __error: unknown }).__error === true
  ) {
    const err = arg as { name?: string; message?: string; stack?: string };
    return `${err.name ?? "Error"}: ${err.message ?? ""}\n${
      err.stack ?? ""
    }`.trim();
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export function forwardWebViewConsoleMessage(
  message: WebViewConsoleMessage
): void {
  const formatted = `[webview] ${message.args.map(formatArg).join(" ")}`;
  switch (message.level) {
    case "error":
      console.error(formatted);
      return;
    case "warn":
      console.warn(formatted);
      return;
    case "info":
      console.info(formatted);
      return;
    case "debug":
      console.debug(formatted);
      return;
    default:
      console.log(formatted);
  }
}

export function tryParseConsoleMessage(
  raw: string
): WebViewConsoleMessage | null {
  try {
    const parsed = JSON.parse(raw) as { source?: unknown };
    if (parsed.source !== CONSOLE_FORWARD_SOURCE) return null;
    const candidate = parsed as Partial<WebViewConsoleMessage>;
    if (typeof candidate.level !== "string" || !Array.isArray(candidate.args)) {
      return null;
    }
    return {
      source: CONSOLE_FORWARD_SOURCE,
      level: candidate.level as WebViewConsoleLevel,
      args: candidate.args,
    };
  } catch {
    return null;
  }
}
