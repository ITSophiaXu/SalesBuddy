FROM node:22-bookworm-slim
ARG COPILOT_SDK_VERSION
ARG COPILOT_CLI_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# Build arguments must agree with the committed dependency lock.
RUN test -n "$COPILOT_SDK_VERSION" && test -n "$COPILOT_CLI_VERSION" \
    && node -e 'const p=require("./package.json").dependencies;if(p["@github/copilot-sdk"]!==process.argv[1]||p["@github/copilot"]!==process.argv[2])process.exit(1)' "$COPILOT_SDK_VERSION" "$COPILOT_CLI_VERSION" \
    && npm ci --omit=dev --no-audit --no-fund \
    && ln -s /app/node_modules/.bin/copilot /usr/local/bin/copilot \
    && npm cache clean --force
COPY vehicle-comparison.js artifact-workbench.js workbench-ui.js experience-model.js experience-ui.js experience.css index.html styles.css cowork.css chat.css ux.css app.js cowork.js cowork-ui.js chat-ui.js workspace-model.js workspace-ui.js task-flow.js task-ui.js customer-profile.js profile-ui.js ai-client.js markdown.js execution.js poster.js domain.js data.js server.js ./
COPY assets ./assets
COPY server ./server
COPY scripts/check-copilot.mjs ./scripts/check-copilot.mjs
RUN mkdir -p /home/node/.copilot /home/node/.cache \
    && chown node:node /home/node/.copilot /home/node/.cache
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 AI_PROVIDER=copilot
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
