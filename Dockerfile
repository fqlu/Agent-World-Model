# Agent World Model — container for Cloud Run.
# Build from the repo root:  gcloud run deploy --source .   (or docker build .)
# Copies web/ plus spec/ and profiles/, which the app reads at runtime.
FROM node:22-bookworm-slim AS build
WORKDIR /app/web
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
COPY spec/ /app/spec/
COPY profiles/ /app/profiles/
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 \
    SPEC_DIR=/app/spec PROFILES_DIR=/app/profiles HUB_DATA_DIR=/data
WORKDIR /app/web
COPY --from=build /app/web /app/web
COPY --from=build /app/spec /app/spec
COPY --from=build /app/profiles /app/profiles
RUN mkdir -p /data
EXPOSE 8080
CMD ["npx", "next", "start", "-p", "8080"]
