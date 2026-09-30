# Pinned to the Bun release this repo standardizes on (root `packageManager`).
# The 1.3.x line publishes no `-debian` variant; `-slim` is the Debian build.
# Official Docker Hub linux/amd64 manifest; resolved 2026-09-30.
FROM oven/bun:1.3.11-slim@sha256:49a1dfafe49d774e0b75a17bd596d5a8e49231c1fab76d9a30b6fc690c30f30e AS runtime

WORKDIR /app

# The relay has no runtime dependencies, so there is no install step and no
# lockfile in the image: the source is the artifact. `.dockerignore` keeps
# `src/*.test.ts` out of the build context.
COPY package.json tsconfig.json ./
COPY src ./src

USER bun

# Render's default service port, and the one it advertises as this service's
# internal address. Render reserves only 18012, 18013 and 19099.
ENV HOST=0.0.0.0 \
    PORT=10000

EXPOSE 10000

CMD ["bun", "src/index.ts"]
