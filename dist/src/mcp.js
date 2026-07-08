#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcpTools.js";
export async function startMcp() {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("1Password local paste MCP running on stdio.");
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
    startMcp().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
//# sourceMappingURL=mcp.js.map