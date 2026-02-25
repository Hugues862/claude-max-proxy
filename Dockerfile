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

# Copy patched server that fixes multi-turn streaming and enables WebFetch/WebSearch
COPY server-patch.ts src/proxy/server.ts

EXPOSE 3456

CMD ["bun", "run", "proxy"]
