import { startServer, stopServer } from "claude-max-api-proxy/dist/server/index.js";
import { verifyClaude, verifyAuth } from "claude-max-api-proxy/dist/subprocess/manager.js";

const port = parseInt(process.env.PORT || "3456", 10);

console.log("Claude Max API Proxy\n");

const cli = await verifyClaude();
if (!cli.ok) { console.error(cli.error); process.exit(1); }
console.log(`  CLI: ${cli.version || "OK"}`);

const auth = await verifyAuth();
if (!auth.ok) { console.error(auth.error); process.exit(1); }
console.log("  Auth: OK\n");

await startServer({ port, host: "0.0.0.0" });
console.log(`Listening on 0.0.0.0:${port}\n`);

const shutdown = async () => { await stopServer(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
