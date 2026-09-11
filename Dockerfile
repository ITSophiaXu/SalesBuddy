FROM node:22-bookworm-slim
ARG COPILOT_SDK_VERSION
ARG COPILOT_CLI_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
# Versions are resolved once by prepare.sh and saved in the deployment manifest.
RUN test -n "$COPILOT_SDK_VERSION" && test -n "$COPILOT_CLI_VERSION" \
    && npm install --omit=dev --save-exact "@github/copilot-sdk@${COPILOT_SDK_VERSION}" \
    && npm install --global "@github/copilot@${COPILOT_CLI_VERSION}" \
    && npm cache clean --force
COPY index.html styles.css app.js ai-client.js poster.js domain.js data.js server.js ./
COPY assets ./assets
COPY server ./server
COPY scripts/check-copilot.mjs ./scripts/check-copilot.mjs
RUN mkdir -p /home/node/.copilot && chown node:node /home/node/.copilot
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 AI_PROVIDER=copilot
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
