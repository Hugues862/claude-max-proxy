FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code claude-max-api-proxy

COPY start.mjs /app/start.mjs

EXPOSE 3456

CMD ["node", "/app/start.mjs"]
