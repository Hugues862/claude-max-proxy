FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code claude-max-api-proxy

EXPOSE 3456

CMD ["claude-max-api"]
