#!/usr/bin/env node
import { isMain } from "./isMain.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcpTools.js";

export async function startMcp(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("1Password local paste MCP running on stdio.");
}

if (isMain(import.meta.url)) {
  startMcp().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
