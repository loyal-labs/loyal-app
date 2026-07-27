# Pinned to the Bun release this repo standardizes on (root `packageManager`).
# The 1.3.x line publishes no `-debian` variant; `-slim` is the Debian build.
FROM oven/bun:1.3.11-slim AS runtime

WORKDIR /app

# One runtime dependency: the Neon HTTP driver used for the durable state row.
# `--frozen-lockfile` makes an out-of-date `bun.lock` fail the build instead of
# quietly resolving a different version than the one that was tested.
# `--production` keeps the TypeScript toolchain out of the image; the source is
# still the artifact, since Bun runs the `.ts` files directly.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# `.dockerignore` keeps `src/*.test.ts` out of the build context.
COPY tsconfig.json ./
COPY src ./src

USER bun

# Render's default service port, and the one it advertises as this service's
# internal address. Render reserves only 18012, 18013 and 19099.
ENV HOST=0.0.0.0 \
    PORT=10000

EXPOSE 10000

CMD ["bun", "src/index.ts"]
