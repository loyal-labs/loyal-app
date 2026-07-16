FROM docker.io/clickhouse/clickstack-all-in-one:2.30.1@sha256:bd0bde1b1f2ca0702fdafe269f3552e36b055d25e47692685b1a6018567a2d3c

# The upstream authenticated image hardcodes a public session secret. Replace
# that assignment with a runtime requirement and use tini to forward Render's
# shutdown signal to every process in the all-in-one container.
RUN apk add --no-cache tini=0.19.0-r3 \
  && sed -i 's|^export EXPRESS_SESSION_SECRET=.*$|: "${EXPRESS_SESSION_SECRET:?EXPRESS_SESSION_SECRET is required}"\nexport EXPRESS_SESSION_SECRET|' /etc/local/entry.base.sh \
  && sed -i 's|tcp://ch-server:9000|tcp://127.0.0.1:9000|' /etc/local/entry.base.sh \
  && sed -i 's|mongodb://db:27017|mongodb://127.0.0.1:27017|' /etc/local/entry.base.sh \
  && sed -i 's|ch-server:9363|127.0.0.1:9363|' /etc/local/entry.base.sh \
  && ! grep -Eq '^export EXPRESS_SESSION_SECRET=.' /etc/local/entry.base.sh

COPY --chmod=755 scripts/entrypoint.sh /usr/local/bin/loyal-clickstack-entrypoint
COPY --chmod=755 scripts/smoke-live.sh /usr/local/bin/loyal-clickstack-smoke-live

ENV PORT=8080 \
    HYPERDX_APP_PORT=8080 \
    HYPERDX_APP_LISTEN_HOSTNAME=0.0.0.0 \
    USAGE_STATS_ENABLED=false

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8080}/api/health" || exit 1

STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "-g", "--", "/usr/local/bin/loyal-clickstack-entrypoint"]
