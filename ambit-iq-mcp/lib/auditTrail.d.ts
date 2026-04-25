export function forwardAuditLog(
  auditLog: unknown,
  opts?: unknown,
): Promise<{ forwarded: boolean; reason: string }>;

export function generateAuditSummary(auditLog: unknown, style?: string): string;

export class AuditStore {
  constructor(options?: { logsDir?: string; forwarder?: unknown; forwarderOptions?: unknown });
  writeAuditLog(logRecord: unknown): Promise<{
    filePath: string;
    fileName: string;
    markdownFilePath: string;
    markdownFileName: string;
    payload: unknown;
    markdownSummary: string;
    forwardResult: unknown;
  }>;
}
