FROM oven/bun:1-slim

RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally via npm (need node for it)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g @anthropic-ai/claude-code && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clone the rynfar proxy and install deps
RUN git clone https://github.com/rynfar/opencode-claude-max-proxy.git . && \
    bun install

# Patch: Allow WebFetch and WebSearch (remove from blocked list so Claude can access internet)
# Patch: Bind to 0.0.0.0 instead of 127.0.0.1
RUN sed -i 's/"WebFetch", "WebSearch", "TodoWrite"/"TodoWrite"/' src/proxy/server.ts && \
    sed -i 's/host: "127.0.0.1"/host: process.env.CLAUDE_PROXY_HOST || "0.0.0.0"/' src/proxy/types.ts

EXPOSE 3456

CMD ["bun", "run", "proxy"]
