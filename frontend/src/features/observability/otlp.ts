import type { NormalizedErrorEvent } from "./error-contract";
import type { NormalizedLifecycleEvent } from "./lifecycle-contract";

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
  if (event.ingestRelease) {
    attributes.push(
      stringAttribute("loyal.ingest.release", event.ingestRelease)
    );
  }

  const diagnostics = event.browserDiagnostics;
  if (diagnostics) {
    attributes.push(stringAttribute("loyal.chunk.url", diagnostics.chunkUrl));
    attributes.push(boolAttribute("network.online", diagnostics.networkOnline));

    const strings: Array<[string, string | undefined]> = [
      [
        "network.connection.effective_type",
        diagnostics.connectionEffectiveType,
      ],
      ["document.visibility_state", diagnostics.documentVisibilityState],
    ];
    for (const [key, value] of strings) {
      if (value !== undefined) {
        attributes.push(stringAttribute(key, value));
      }
    }

    const integers: Array<[string, number | undefined]> = [
      ["network.connection.rtt_ms", diagnostics.connectionRttMs],
      ["loyal.resource.decoded_body_size", diagnostics.resourceDecodedBodySize],
      ["loyal.resource.encoded_body_size", diagnostics.resourceEncodedBodySize],
      ["loyal.resource.response_status", diagnostics.resourceResponseStatus],
      ["loyal.resource.transfer_size", diagnostics.resourceTransferSize],
    ];
    for (const [key, value] of integers) {
      if (value !== undefined) {
        attributes.push(intAttribute(key, value));
      }
    }

    const doubles: Array<[string, number | undefined]> = [
      ["network.connection.downlink_mbps", diagnostics.connectionDownlinkMbps],
      ["loyal.resource.duration_ms", diagnostics.resourceDurationMs],
    ];
    for (const [key, value] of doubles) {
      if (value !== undefined) {
        attributes.push(doubleAttribute(key, value));
      }
    }

    if (diagnostics.connectionSaveData !== undefined) {
      attributes.push(
        boolAttribute(
          "network.connection.save_data",
          diagnostics.connectionSaveData
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
                severityNumber: 17,
                severityText: "ERROR",
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

export function buildOtlpLifecyclePayload(
  event: NormalizedLifecycleEvent
): unknown {
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
    ["loyal.wallet.address", event.walletAddress],
    ["loyal.error.code", event.errorCode],
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
  const isError = event.outcome === "failed" || event.recoveryRequired === true;
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
