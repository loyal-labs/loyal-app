# Pinned to the Bun release this repo standardizes on (root `packageManager`).
# The 1.3.x line publishes no `-debian` variant; `-slim` is the Debian build.
FROM oven/bun:1.3.11-slim AS runtime

WORKDIR /app

# The relay has no runtime dependencies, so there is no install step and no
# lockfile in the image: the source is the artifact. `.dockerignore` keeps
# `src/*.test.ts` out of the build context.
COPY package.json tsconfig.json ./
COPY src ./src

USER bun

# Render reserves 10000, 18012, 18013 and 19099 on the private network, so the
# relay has to listen somewhere else.
ENV HOST=0.0.0.0 \
    PORT=3000

EXPOSE 3000

CMD ["bun", "src/index.ts"]
