export interface PasteMeta {
  slug: string;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
  sizeBytes: number;
  originalFilename: string | null;
  label: string | null;
  issueUrl: string | null;
  uploaderIp: string | null;
  uploaderCountry: string | null;
  userAgent: string | null;
  analyzed: boolean;
  analyzedAt: string | null; // ISO 8601, set when marked as analyzed
  analyzedBy: string | null; // admin email that marked it as analyzed
  agentAccessCount: number; // successful reads through the agent API
  agentLastAccessAt: string | null; // ISO 8601
  agentLastAccessBy: string | null; // admin email owning the token, or "instance" for the legacy AGENT_API_TOKEN
}
