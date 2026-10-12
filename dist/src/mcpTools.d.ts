import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ClipboardReader } from "./paste.js";
export declare function createMcpServer(options?: {
    clipboard?: ClipboardReader;
    captureClock?: () => number;
}): McpServer;
