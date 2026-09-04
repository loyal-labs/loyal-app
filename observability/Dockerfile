FROM docker.io/clickhouse/clickstack-all-in-one:2.31.0@sha256:b01cc48cb5aaf30d630865a88217c826ab86fb9828374201f6cd7c539d5beed1

# The upstream authenticated image hardcodes a public session secret. Replace
# that assignment with a runtime requirement and use tini to forward Render's
# shutdown signal to every process in the all-in-one container.
RUN apk add --no-cache nginx=1.30.4-r0 tini=0.19.0-r3 \
  && sed -i 's|^export EXPRESS_SESSION_SECRET=.*$|: "${EXPRESS_SESSION_SECRET:?EXPRESS_SESSION_SECRET is required}"\nexport EXPRESS_SESSION_SECRET|' /etc/local/entry.base.sh \
  && sed -i 's|^export CLICKHOUSE_LOG_LEVEL="error"$|export CLICKHOUSE_LOG_LEVEL="fatal"|' /etc/local/entry.base.sh \
  && sed -i 's|<level from_env="CLICKHOUSE_LOG_LEVEL" />|<level>fatal</level>|' /etc/clickhouse-server/config.xml \
  && sed -i '/^echo "127\.0\.0\.1      ch-server" >> \/etc\/hosts$/d; /^echo "127\.0\.0\.1      db" >> \/etc\/hosts$/d' /etc/local/entry.base.sh \
  && sed -i 's|ch-server|127.0.0.1|g' /etc/local/entry.base.sh \
  && sed -i 's|mongodb://db:27017|mongodb://127.0.0.1:27017|' /etc/local/entry.base.sh \
  && grep -q '^export CLICKHOUSE_LOG_LEVEL="fatal"$' /etc/local/entry.base.sh \
  && grep -q '<level>fatal</level>' /etc/clickhouse-server/config.xml \
  && ! grep -Eq '^export EXPRESS_SESSION_SECRET=.|ch-server|mongodb://db:' /etc/local/entry.base.sh

COPY --chmod=755 scripts/entrypoint.sh /usr/local/bin/loyal-clickstack-entrypoint
COPY --chmod=755 scripts/smoke-live.sh /usr/local/bin/loyal-clickstack-smoke-live
COPY nginx.conf /etc/nginx/nginx.conf

ENV PORT=8080 \
    HYPERDX_APP_PORT=8081 \
    HYPERDX_APP_LISTEN_HOSTNAME=127.0.0.1 \
    USAGE_STATS_ENABLED=false

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8080}/api/health" || exit 1

STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "-g", "--", "/usr/local/bin/loyal-clickstack-entrypoint"]
