# EigenCompute TEE Deployment — CuratedLP Venice Analyzer
#
# This image runs the full Venice AI inference pipeline (sentiment + analysis)
# inside an EigenCompute Trusted Execution Environment (Intel TDX).
#
# Build:
#   docker build --platform linux/amd64 -t curatedlp/venice-analyzer .
#
# Run locally:
#   docker run --platform linux/amd64 -p 3000:3000 \
#     -e VENICE_API_KEY=<key> curatedlp/venice-analyzer
#
# Deploy to EigenCompute:
#   ecloud compute app deploy
#
# The TEE attestation covers both Venice calls (sentiment + analysis),
# proving the full pipeline ran unmodified inside the enclave.

FROM --platform=linux/amd64 node:20-slim

# Required by EigenCompute TEE environment
USER root

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy Caddyfile for EigenCompute TLS (used by layered TEE build)
COPY Caddyfile ./Caddyfile

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src/eigencompute-server.ts ./src/
COPY src/lib/config.ts src/lib/types.ts src/lib/logger.ts src/lib/cache.ts ./src/lib/

# Install dev deps for compilation, build, then remove dev deps
RUN npm install --save-dev typescript @types/node && \
    npx tsc && \
    npm prune --omit=dev

# Expose port for HTTP trigger from agent
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# Entry point: HTTP server that runs both Venice calls
CMD ["node", "dist/eigencompute-server.js"]
