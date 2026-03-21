# EigenCompute TEE Deployment — CuratedLP Venice Analyzer
#
# This image runs the full Venice AI inference pipeline (sentiment + analysis)
# inside an EigenCompute Trusted Execution Environment (Intel TDX).
#
# Build:
#   cd agent && docker buildx build --platform linux/amd64 --no-cache \
#     -t <dockerhub>/venice-analyzer:v1.0.0 --push .
#
# Run locally:
#   docker run --platform linux/amd64 -p 3000:3000 \
#     -e VENICE_API_KEY=<key> <dockerhub>/venice-analyzer:v1.0.0
#
# Deploy to EigenCompute:
#   ecloud compute app deploy --image-ref <dockerhub>/venice-analyzer:v1.0.0

FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

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

# Must run as root (TEE requirement)
USER root

# Entry point: HTTP server that runs both Venice calls
CMD ["node", "dist/eigencompute-server.js"]
