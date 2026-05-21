import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAmbitIqHandlers } from "./handlers.js";
import { AuditStore } from "../lib/auditTrail.js";

const server = new Server(
  {
    name: "Project Vail",
    version: "2.0.0",
  },
  {
    capabilities: { tools: {} },
  },
);

const auditStore = new AuditStore();
registerAmbitIqHandlers(server, { auditStore });

const transport = new StdioServerTransport();
await server.connect(transport);
