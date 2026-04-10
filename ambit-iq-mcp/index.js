import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAmbitIqHandlers } from "./lib/handlers.js";
import { AuditStore } from "./lib/auditTrail.js";

const server = new Server(
  {
    name: "ambit-iq-governance",
    version: "1.0.0",
  },
  {
    capabilities: { tools: {} },
  },
);

const auditStore = new AuditStore();
registerAmbitIqHandlers(server, { auditStore });

const transport = new StdioServerTransport();
await server.connect(transport);
