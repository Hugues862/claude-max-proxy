FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code claude-max-api-proxy

# Patch: bind to 0.0.0.0 for Docker networking
# Patch: handle array content format (OpenAI vision format)
RUN PROXY_DIR=$(npm root -g)/claude-max-api-proxy && \
    sed -i 's/host = "127.0.0.1"/host = process.env.HOST || "0.0.0.0"/' $PROXY_DIR/dist/server/index.js && \
    sed -i 's/parts.push(msg.content);/parts.push(typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.filter(c => c.type === "text").map(c => c.text).join("\\n") : String(msg.content));/g' $PROXY_DIR/dist/adapter/openai-to-cli.js

EXPOSE 3456

CMD ["claude-max-api"]
