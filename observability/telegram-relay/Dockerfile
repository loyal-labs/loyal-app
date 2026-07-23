# Pinned to the Bun release this repo standardizes on (root `packageManager`).
FROM oven/bun:1.3.11-debian AS runtime

WORKDIR /app

# The relay has no runtime dependencies, so there is no install step and no
# lockfile in the image: the source is the artifact. `.dockerignore` keeps
# `src/*.test.ts` out of the build context.
COPY package.json tsconfig.json ./
COPY src ./src

USER bun

ENV HOST=0.0.0.0 \
    PORT=10000

EXPOSE 10000

CMD ["bun", "src/index.ts"]
