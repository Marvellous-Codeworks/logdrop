export interface PasteMeta {
  slug: string;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
  sizeBytes: number;
  originalFilename: string | null;
  label: string | null;
  uploaderIp: string | null;
  uploaderCountry: string | null;
  userAgent: string | null;
}
