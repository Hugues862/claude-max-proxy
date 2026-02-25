import { Hono } from "hono"
import { cors } from "hono/cors"
import { query } from "@anthropic-ai/claude-agent-sdk"
import type { Context } from "hono"
import type { ProxyConfig } from "./types"
import { DEFAULT_PROXY_CONFIG } from "./types"
import { claudeLog } from "../logger"
import { execSync } from "child_process"
import { existsSync } from "fs"
import { fileURLToPath } from "url"
import { join, dirname } from "path"
import { opencodeMcpServer } from "../mcpTools"

const BLOCKED_BUILTIN_TOOLS = [
  "Read", "Write", "Edit", "MultiEdit",
  "Bash", "Glob", "Grep", "NotebookEdit",
  "TodoWrite"
]

const MCP_SERVER_NAME = "opencode"

const ALLOWED_MCP_TOOLS = [
  `mcp__${MCP_SERVER_NAME}__read`,
  `mcp__${MCP_SERVER_NAME}__write`,
  `mcp__${MCP_SERVER_NAME}__edit`,
  `mcp__${MCP_SERVER_NAME}__bash`,
  `mcp__${MCP_SERVER_NAME}__glob`,
  `mcp__${MCP_SERVER_NAME}__grep`
]

function resolveClaudeExecutable(): string {
  try {
    const sdkPath = fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk"))
    const sdkCliJs = join(dirname(sdkPath), "cli.js")
    if (existsSync(sdkCliJs)) return sdkCliJs
  } catch {}

  try {
    const claudePath = execSync("which claude", { encoding: "utf-8" }).trim()
    if (claudePath && existsSync(claudePath)) return claudePath
  } catch {}

  throw new Error("Could not find Claude Code executable. Install via: npm install -g @anthropic-ai/claude-code")
}

const claudeExecutable = resolveClaudeExecutable()

function mapModelToClaudeModel(model: string): "sonnet" | "opus" | "haiku" {
  if (model.includes("opus")) return "opus"
  if (model.includes("haiku")) return "haiku"
  return "sonnet"
}

export function createProxyServer(config: Partial<ProxyConfig> = {}) {
  const finalConfig = { ...DEFAULT_PROXY_CONFIG, ...config }
  const app = new Hono()

  app.use("*", cors())

  app.get("/", (c) => {
    return c.json({
      status: "ok",
      service: "claude-max-proxy",
      version: "2.0.0",
      format: "anthropic",
      endpoints: ["/v1/messages", "/messages"]
    })
  })

  // Health endpoint for compatibility
  app.get("/health", (c) => {
    return c.json({ status: "ok", provider: "claude-agent-sdk", timestamp: new Date().toISOString() })
  })

  const handleMessages = async (c: Context) => {
    try {
      const body = await c.req.json()
      const model = mapModelToClaudeModel(body.model || "sonnet")
      const stream = body.stream ?? true

      claudeLog("proxy.anthropic.request", { model, stream, messageCount: body.messages?.length })

      // Build system context from the request's system prompt
      let systemContext = ""
      if (body.system) {
        if (typeof body.system === "string") {
          systemContext = body.system
        } else if (Array.isArray(body.system)) {
          systemContext = body.system
            .filter((b: any) => b.type === "text" && b.text)
            .map((b: any) => b.text)
            .join("\n")
        }
      }

      // Convert messages to a text prompt
      const conversationParts = body.messages
        ?.map((m: { role: string; content: string | Array<{ type: string; text?: string }> }) => {
          const role = m.role === "assistant" ? "Assistant" : "Human"
          let content: string
          if (typeof m.content === "string") {
            content = m.content
          } else if (Array.isArray(m.content)) {
            content = m.content
              .filter((block: any) => block.type === "text" && block.text)
              .map((block: any) => block.text)
              .join("")
          } else {
            content = String(m.content)
          }
          return `${role}: ${content}`
        })
        .join("\n\n") || ""

      // Combine system context with conversation
      const prompt = systemContext
        ? `${systemContext}\n\n${conversationParts}`
        : conversationParts

      // Always use non-streaming query() internally to avoid multi-turn event ordering issues
      // Then format the response as either streaming SSE or non-streaming JSON
      let fullContent = ""
      const response = query({
        prompt,
        options: {
          maxTurns: 100,
          model,
          pathToClaudeCodeExecutable: claudeExecutable,
          disallowedTools: [...BLOCKED_BUILTIN_TOOLS],
          allowedTools: [...ALLOWED_MCP_TOOLS],
          mcpServers: {
            [MCP_SERVER_NAME]: opencodeMcpServer
          }
        }
      })

      for await (const message of response) {
        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "text") {
              fullContent += block.text
            }
          }
        }
      }

      if (!fullContent) {
        fullContent = "I can help with that. Could you provide more details about what you'd like me to do?"
      }

      if (!stream) {
        // Non-streaming: return standard Anthropic response
        return c.json({
          id: `msg_${Date.now()}`,
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: fullContent }],
          model: body.model,
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 }
        })
      }

      // Streaming: emit SSE events in correct order with collected content
      const encoder = new TextEncoder()
      const msgId = `msg_${Date.now()}`
      const readable = new ReadableStream({
        start(controller) {
          // message_start
          controller.enqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify({
            type: "message_start",
            message: {
              id: msgId,
              type: "message",
              role: "assistant",
              content: [],
              model: body.model,
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 }
            }
          })}\n\n`))

          // content_block_start
          controller.enqueue(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" }
          })}\n\n`))

          // content_block_delta with full text
          controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: fullContent }
          })}\n\n`))

          // content_block_stop
          controller.enqueue(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({
            type: "content_block_stop",
            index: 0
          })}\n\n`))

          // message_delta
          controller.enqueue(encoder.encode(`event: message_delta\ndata: ${JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 0 }
          })}\n\n`))

          // message_stop
          controller.enqueue(encoder.encode(`event: message_stop\ndata: ${JSON.stringify({
            type: "message_stop"
          })}\n\n`))

          controller.close()
        }
      })

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        }
      })
    } catch (error) {
      claudeLog("proxy.error", { error: error instanceof Error ? error.message : String(error) })
      return c.json({
        type: "error",
        error: {
          type: "api_error",
          message: error instanceof Error ? error.message : "Unknown error"
        }
      }, 500)
    }
  }

  app.post("/v1/messages", handleMessages)
  app.post("/messages", handleMessages)

  return { app, config: finalConfig }
}

export async function startProxyServer(config: Partial<ProxyConfig> = {}) {
  const { app, config: finalConfig } = createProxyServer(config)

  const server = Bun.serve({
    port: finalConfig.port,
    hostname: finalConfig.host,
    fetch: app.fetch
  })

  console.log(`Claude Max Proxy (Anthropic API) running at http://${finalConfig.host}:${finalConfig.port}`)
  return server
}
