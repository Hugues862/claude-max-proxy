FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code claude-max-api-proxy

# Patch the server to bind to 0.0.0.0 instead of 127.0.0.1
RUN PROXY_DIR=$(npm root -g)/claude-max-api-proxy && \
    sed -i 's/host = "127.0.0.1"/host = process.env.HOST || "0.0.0.0"/' $PROXY_DIR/dist/server/index.js

EXPOSE 3456

CMD ["claude-max-api"]
