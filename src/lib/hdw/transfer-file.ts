export interface TransferFileContents {
  schema: number;
  createdAt: string;
  records: unknown[];
}

export function createTransferFile(records: unknown[], schema: number, createdAt = new Date().toISOString()): string {
  return JSON.stringify({ app: "HDW CONNECT record transfer", format: 1, schema, createdAt, records }, null, 2);
}

export function parseTransferFile(text: string): TransferFileContents {
  if (text.length > 50_000_000) throw new Error("The transfer file is too large to open on this device.");
  let value: unknown;
  try { value = JSON.parse(text) as unknown; } catch { throw new Error("This is not a valid HDW CONNECT transfer file."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("This is not a supported HDW CONNECT transfer file.");
  const candidate = value as Record<string, unknown>;
  if (candidate["app"] !== "HDW CONNECT record transfer" || candidate["format"] !== 1 || !Number.isInteger(candidate["schema"]) || Number(candidate["schema"]) < 1 || !Array.isArray(candidate["records"]) || typeof candidate["createdAt"] !== "string") {
    throw new Error("This is not a supported HDW CONNECT transfer file.");
  }
  return { schema: Number(candidate["schema"]), createdAt: candidate["createdAt"], records: candidate["records"] };
}
