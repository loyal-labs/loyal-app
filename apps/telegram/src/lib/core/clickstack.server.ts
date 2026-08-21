import "server-only";

import { publicEnv } from "./config/public";
import { serverEnv } from "./config/server";

const EXPORT_TIMEOUT_MS = 1250;
const MAX_RELEASE_LENGTH = 80;
const MAX_ENVIRONMENT_LENGTH = 32;
const MAX_TEXT_LENGTH = 512;
const MAX_STACK_LENGTH = 4096;
const RESOURCE_VALUE_PATTERN = /[^A-Za-z0-9._-]/g;

type OtlpAttribute = {
  key: string;
  value: { stringValue: string };
};

type ReportClickStackErrorArgs = {
  error: Error;
  errorCode: string;
  operation: string;
  pathname: string;
  stage: string;
  walletAddress?: string;
};

const stringAttribute = (key: string, value: string): OtlpAttribute => ({
  key,
  value: { stringValue: value },
});

const sanitizeText = (value: string, maxLength: number): string =>
  value.replace(/\s+/g, " ").trim().slice(0, maxLength) || "unknown";

const toUnixNano = (timestamp: string): string =>
  (BigInt(Date.parse(timestamp)) * BigInt(1_000_000)).toString();

const getTelemetryConfig = (): {
  endpoint: string;
  ingestionKey: string;
} | null => {
  const rawEndpoint = serverEnv.observabilityOtlpEndpoint;
  const ingestionKey = serverEnv.observabilityIngestionApiKey;
  if (!rawEndpoint || !ingestionKey) {
    return null;
  }

  try {
    const url = new URL(rawEndpoint);
    const isLocalHttp =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (url.protocol !== "https:" && !isLocalHttp) {
      return null;
    }

    url.pathname = "/v1/logs";
    url.search = "";
    url.hash = "";
    return { endpoint: url.toString(), ingestionKey };
  } catch {
    return null;
  }
};

const getRelease = (): string => {
  const release = publicEnv.gitCommitHash;
  return (
    release.replace(RESOURCE_VALUE_PATTERN, "_").slice(0, MAX_RELEASE_LENGTH) ||
    "unknown"
  );
};

const getDeploymentEnvironment = (): string => {
  const environment = publicEnv.appEnvironment;
  return (
    environment
      .replace(RESOURCE_VALUE_PATTERN, "_")
      .slice(0, MAX_ENVIRONMENT_LENGTH) || "unknown"
  );
};

export const reportClickStackError = async ({
  error,
  errorCode,
  operation,
  pathname,
  stage,
  walletAddress,
}: ReportClickStackErrorArgs): Promise<boolean> => {
  const config = getTelemetryConfig();
  if (!config) {
    return false;
  }

  const timestamp = new Date().toISOString();
  const timeUnixNano = toUnixNano(timestamp);
  const attributes = [
    stringAttribute("loyal.runtime", "node"),
    stringAttribute("loyal.operation", operation),
    stringAttribute("loyal.flow.name", "gasless.claim"),
    stringAttribute("loyal.flow.stage", stage),
    stringAttribute("loyal.error.code", errorCode),
    stringAttribute("url.path", pathname),
    stringAttribute("http.request.method", "POST"),
    stringAttribute("exception.type", sanitizeText(error.name || "Error", 80)),
    stringAttribute(
      "exception.message",
      sanitizeText(error.message, MAX_TEXT_LENGTH)
    ),
  ];

  if (error.stack) {
    attributes.push(
      stringAttribute(
        "exception.stacktrace",
        sanitizeText(error.stack, MAX_STACK_LENGTH)
      )
    );
  }
  if (walletAddress) {
    attributes.push(stringAttribute("loyal.wallet.address", walletAddress));
  }

  const payload = {
    resourceLogs: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", "loyal-telegram"),
            stringAttribute("service.version", getRelease()),
            stringAttribute(
              "deployment.environment.name",
              getDeploymentEnvironment()
            ),
          ],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                attributes,
                body: { stringValue: "gasless.claim.disabled_top_up_attempted" },
                observedTimeUnixNano: timeUnixNano,
                severityNumber: 17,
                severityText: "ERROR",
                timeUnixNano,
              },
            ],
            scope: {
              name: "loyal.telegram.errors",
              version: "1",
            },
          },
        ],
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
  try {
    const response = await fetch(config.endpoint, {
      body: JSON.stringify(payload),
      cache: "no-store",
      headers: {
        authorization: config.ingestionKey,
        "content-type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};
