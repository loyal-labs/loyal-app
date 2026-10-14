import type { NormalizedErrorEvent } from "./error-contract";
import {
  lifecycleFailureCategory,
  type NormalizedLifecycleEvent,
} from "./lifecycle-contract";
import type { NormalizedLoadingMetric } from "./metrics-contract";

export type OtlpAttribute = {
  key: string;
  value:
    | { boolValue: boolean }
    | { doubleValue: number }
    | { intValue: string }
    | { stringValue: string };
};

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function intAttribute(key: string, value: number): OtlpAttribute {
  return { key, value: { intValue: String(value) } };
}

function doubleAttribute(key: string, value: number): OtlpAttribute {
  return { key, value: { doubleValue: value } };
}

function boolAttribute(key: string, value: boolean): OtlpAttribute {
  return { key, value: { boolValue: value } };
}

function toUnixNano(timestamp: string): string {
  return (BigInt(Date.parse(timestamp)) * BigInt(1_000_000)).toString();
}

const EXPECTED_LOCAL_FAILURES = new Set([
  "insufficient_native_sol",
  "wallet_account_mismatch",
  "wallet_authorization_expired",
  "wallet_connection_failed",
  "wallet_connection_timeout",
  "wallet_signing_failed",
  "wallet_unavailable",
]);

/**
 * The generic Errors alert is a service-health page, not a feed of every
 * user-visible failure. Keep expected device/session and caller-state failures
 * observable at INFO while failing closed for unknown causes, our own bugs,
 * upstream/RPC incidents and anything that may need money-movement recovery.
 */
export function isAlertableLifecycleEvent(
  event: NormalizedLifecycleEvent
): boolean {
  // Synthetic failures are evaluated by the dedicated canary alert.
  if (event.trafficKind === "synthetic") return false;
  if (event.recoveryRequired === true) return true;
  if (event.outcome !== "failed") return false;
  if (
    event.persistenceState === "failed" ||
    event.chainState === "failed" ||
    (event.httpStatus !== undefined && event.httpStatus >= 500) ||
    event.errorDetail === "kamino_upstream_unavailable" ||
    event.errorDetail === "rpc_request_failed"
  ) {
    return true;
  }
  if (event.errorCode && EXPECTED_LOCAL_FAILURES.has(event.errorCode)) {
    return false;
  }
  if (event.errorCode !== "request_failed") return true;
  if (
    event.errorDetail === "network_unreachable" ||
    event.errorDetail === "request_timeout"
  ) {
    return false;
  }
  if (
    event.httpStatus !== undefined &&
    event.httpStatus >= 400 &&
    event.httpStatus < 500
  ) {
    return false;
  }
  // Old clients do not carry a cause token. Keep unknown statusless failures
  // alertable until their cause is known rather than silently hiding a bug.
  return true;
}

export function buildOtlpErrorPayload(event: NormalizedErrorEvent): unknown {
  const attributes = [
    stringAttribute("loyal.runtime", event.runtime),
    stringAttribute("loyal.operation", event.operation),
    stringAttribute("url.path", event.pathname),
    stringAttribute("exception.type", event.exception.name),
    stringAttribute("exception.message", event.exception.message),
  ];

  if (event.exception.stack) {
    attributes.push(
      stringAttribute("exception.stacktrace", event.exception.stack)
    );
  }
  if (event.method) {
    attributes.push(stringAttribute("http.request.method", event.method));
  }
  if (event.clientBuildId) {
    attributes.push(
      stringAttribute("loyal.client.build_id", event.clientBuildId)
    );
  }
  if (event.pageSessionId) {
    attributes.push(
      stringAttribute("loyal.page_session.id", event.pageSessionId)
    );
  }
  if (event.deviceId) {
    attributes.push(stringAttribute("loyal.device.id", event.deviceId));
  }
  if (event.devicePlatform) {
    attributes.push(
      stringAttribute("loyal.device.platform", event.devicePlatform)
    );
  }
  const diagnostics = event.browserDiagnostics;
  if (diagnostics) {
    attributes.push(stringAttribute("loyal.chunk.url", diagnostics.chunkUrl));
    attributes.push(boolAttribute("network.online", diagnostics.networkOnline));

    if (diagnostics.recoveryAction !== undefined) {
      attributes.push(
        stringAttribute(
          "loyal.chunk.recovery_action",
          diagnostics.recoveryAction
        )
      );
    }

    if (diagnostics.connectionEffectiveType !== undefined) {
      attributes.push(
        stringAttribute(
          "network.connection.effective_type",
          diagnostics.connectionEffectiveType
        )
      );
    }

    const integers: Array<[string, number | undefined]> = [
      ["network.connection.rtt_ms", diagnostics.connectionRttMs],
      ["loyal.resource.response_status", diagnostics.resourceResponseStatus],
      ["loyal.resource.transfer_size", diagnostics.resourceTransferSize],
    ];
    for (const [key, value] of integers) {
      if (value !== undefined) {
        attributes.push(intAttribute(key, value));
      }
    }

    if (diagnostics.resourceDurationMs !== undefined) {
      attributes.push(
        doubleAttribute(
          "loyal.resource.duration_ms",
          diagnostics.resourceDurationMs
        )
      );
    }
  }

  const timeUnixNano = toUnixNano(event.timestamp);

  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", event.serviceName),
            stringAttribute("service.version", event.release),
            stringAttribute(
              "deployment.environment.name",
              event.deploymentEnvironment
            ),
          ],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                attributes,
                body: { stringValue: event.exception.message },
                observedTimeUnixNano: timeUnixNano,
                severityNumber: event.severity === "WARN" ? 13 : 17,
                severityText: event.severity === "WARN" ? "WARN" : "ERROR",
                timeUnixNano,
              },
            ],
            scope: {
              name:
                event.serviceName === "loyal-mobile"
                  ? "loyal.mobile.errors"
                  : "loyal.frontend.errors",
              version: "1",
            },
          },
        ],
      },
    ],
  };
}

export function buildOtlpLifecyclePayload(event: NormalizedLifecycleEvent) {
  const attributes: OtlpAttribute[] = [
    stringAttribute("loyal.event.kind", "flow_lifecycle"),
    stringAttribute("loyal.flow.id", event.flowId),
    stringAttribute("loyal.flow.name", event.flowName),
    stringAttribute("loyal.flow.variant", event.flowVariant),
    stringAttribute("loyal.flow.stage", event.stage),
    stringAttribute("loyal.flow.outcome", event.outcome),
    stringAttribute("loyal.flow.source", event.source),
    intAttribute("loyal.duration_ms", event.durationMs),
    intAttribute("loyal.elapsed_ms", event.elapsedMs),
    stringAttribute("url.path", event.pathname),
    stringAttribute("loyal.runtime", event.runtime),
  ];

  const strings: Array<[string, string | undefined]> = [
    ["loyal.journey.id", event.journeyId],
    ["loyal.traffic.kind", event.trafficKind],
    ["loyal.user.id", event.userId],
    ["loyal.rum.session_id", event.rumSessionId],
    ["loyal.event.id", event.eventId],
    ["loyal.client.build_id", event.clientBuildId],
    ["loyal.page_session.id", event.pageSessionId],
    ["loyal.device.id", event.deviceId],
    ["loyal.device.platform", event.devicePlatform],
    ["loyal.wallet.address", event.walletAddress],
    ["loyal.wallet.provider", event.walletProvider],
    ["loyal.error.category", lifecycleFailureCategory(event)],
    ["loyal.error.code", event.errorCode],
    ["loyal.error.detail", event.errorDetail],
    ["loyal.error.message", event.errorMessage],
    ["loyal.client.platform", event.clientPlatform],
    ["loyal.execute_now.state", event.executeNowState],
    ["loyal.chain.state", event.chainState],
    ["loyal.persistence.state", event.persistenceState],
    ["loyal.transaction.version", event.transactionVersion],
    ["loyal.policy.mode", event.policyMode],
    ["loyal.auth.proof_kind", event.authProofKind],
    ["loyal.execution.mode", event.executionMode],
    ["loyal.provisioning.outcome", event.provisioningOutcome],
    ["loyal.scheduled_slot.id", event.scheduledSlotId],
  ];
  for (const [key, value] of strings) {
    if (value !== undefined) attributes.push(stringAttribute(key, value));
  }

  const integers: Array<[string, number | undefined]> = [
    ["loyal.attempt.number", event.attemptNumber],
    ["loyal.retry.count", event.retryCount],
    ["loyal.flow.version", event.journeyId ? 2 : 1],
    ["http.response.status_code", event.httpStatus],
    ["loyal.stage.index", event.stageIndex],
    ["loyal.stage.count", event.stageCount],
    ["loyal.instruction.count", event.instructionCount],
  ];
  for (const [key, value] of integers) {
    if (value !== undefined) attributes.push(intAttribute(key, value));
  }

  const booleans: Array<[string, boolean | undefined]> = [
    ["loyal.transaction.lookup_table_used", event.lookupTableUsed],
    ["loyal.setup.required", event.setupRequired],
    ["loyal.review.bypassed", event.reviewBypassed],
    ["loyal.autodeposit_close.required", event.autodepositCloseRequired],
    ["loyal.cleanup.required", event.cleanupRequired],
    ["loyal.recovery.required", event.recoveryRequired],
  ];
  for (const [key, value] of booleans) {
    if (value !== undefined) attributes.push(boolAttribute(key, value));
  }

  const timeUnixNano = toUnixNano(event.timestamp);
  const isError = isAlertableLifecycleEvent(event);
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", event.serviceName),
            stringAttribute("service.version", event.release),
            stringAttribute(
              "deployment.environment.name",
              event.deploymentEnvironment
            ),
          ],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                attributes,
                ...(event.traceId && event.spanId
                  ? {
                      traceId: event.traceId,
                      spanId:
                        event.eventId?.replaceAll("-", "").slice(0, 16) ??
                        event.spanId,
                    }
                  : {}),
                body: {
                  stringValue: `${event.flowName}.${event.stage}.${event.outcome}`,
                },
                observedTimeUnixNano: timeUnixNano,
                severityNumber: isError ? 17 : 9,
                severityText: isError ? "ERROR" : "INFO",
                timeUnixNano,
              },
            ],
            scope: {
              name:
                event.serviceName === "loyal-mobile"
                  ? "loyal.mobile.lifecycle"
                  : "loyal.frontend.lifecycle",
              version: "1",
            },
          },
        ],
      },
    ],
  };
}

// Step spans measure the interval since the previous lifecycle checkpoint.
// The attempt span measures the whole browser flow or backend request.
export function buildOtlpJourneyTracePayload(
  event: NormalizedLifecycleEvent
): unknown | null {
  if (!event.traceId || !event.spanId || !event.eventId) return null;
  const logs = buildOtlpLifecyclePayload(event).resourceLogs[0];
  const attributes = logs.scopeLogs[0].logRecords[0].attributes;
  const end = Date.parse(event.timestamp);
  const span = {
    traceId: event.traceId,
    spanId: event.eventId.replaceAll("-", "").slice(0, 16),
    parentSpanId: event.spanId,
    name: `${event.flowName}.${event.stage}`,
    kind: 1,
    startTimeUnixNano: toUnixNano(
      new Date(end - event.durationMs).toISOString()
    ),
    endTimeUnixNano: toUnixNano(event.timestamp),
    attributes,
    status: {
      code: isAlertableLifecycleEvent({ ...event, trafficKind: "external" })
        ? 2
        : 0,
    },
  };
  const terminal = ["completed", "failed", "cancelled"].includes(event.outcome);
  return {
    resourceSpans: [
      {
        resource: logs.resource,
        scopeSpans: [
          {
            scope: { name: "loyal.frontend.journeys", version: "2" },
            spans: [
              span,
              ...(terminal
                ? [
                    {
                      ...span,
                      spanId: event.spanId,
                      parentSpanId: event.parentSpanId,
                      name: `${event.flowName}.${event.source}`,
                      kind: event.source === "next_api" ? 2 : 1,
                      startTimeUnixNano: toUnixNano(
                        new Date(end - event.elapsedMs).toISOString()
                      ),
                    },
                  ]
                : []),
            ],
          },
        ],
      },
    ],
  };
}

export function buildOtlpLoadingMetricPayload(
  event: NormalizedLoadingMetric
): unknown {
  const attributes: OtlpAttribute[] = [
    stringAttribute("loyal.operation", event.operation),
    stringAttribute("loyal.phase", event.phase),
    stringAttribute("loyal.outcome", event.outcome),
    stringAttribute("url.path", event.pathname),
  ];

  if (event.flowId) {
    attributes.push(stringAttribute("loyal.flow.id", event.flowId));
  }
  if (event.pageSessionId) {
    attributes.push(
      stringAttribute("loyal.page_session.id", event.pageSessionId)
    );
  }
  if (event.appSessionId) {
    attributes.push(
      stringAttribute("loyal.app_session.id", event.appSessionId)
    );
  }
  if (event.deviceId) {
    attributes.push(stringAttribute("loyal.device.id", event.deviceId));
  }
  if (event.platform) {
    attributes.push(stringAttribute("loyal.platform", event.platform));
  }
  if (event.dependency) {
    attributes.push(stringAttribute("loyal.dependency", event.dependency));
  }
  if (event.presentation) {
    attributes.push(stringAttribute("loyal.presentation", event.presentation));
  }
  if (event.requestCount !== undefined) {
    attributes.push(intAttribute("loyal.request.count", event.requestCount));
  }

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", event.serviceName),
            stringAttribute("service.version", event.release),
            stringAttribute(
              "deployment.environment.name",
              event.deploymentEnvironment
            ),
          ],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                description:
                  event.serviceName === "loyal-mobile"
                    ? "Mobile loading latency from a user-visible Loyal flow boundary."
                    : "Browser loading latency from a user-visible Loyal flow boundary.",
                gauge: {
                  dataPoints: [
                    {
                      asDouble: event.durationMs,
                      attributes,
                      timeUnixNano: toUnixNano(event.timestamp),
                    },
                  ],
                },
                name: event.metricName,
                unit: "ms",
              },
            ],
            scope: {
              name:
                event.serviceName === "loyal-mobile"
                  ? "loyal.mobile.loading"
                  : "loyal.frontend.loading",
              version: "1",
            },
          },
        ],
      },
    ],
  };
}
