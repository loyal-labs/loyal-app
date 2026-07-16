import type { NormalizedErrorEvent } from "./error-contract";

type OtlpAttribute = {
  key: string;
  value: { stringValue: string };
};

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
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
              name: "loyal.frontend.errors",
              version: "1",
            },
          },
        ],
      },
    ],
  };
}
