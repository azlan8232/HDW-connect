import { parseTransferFile } from "./transfer-file";

const PURPOSE = "HDW CONNECT encrypted transfer";
const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const base64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const buffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

async function key(passphrase: string, salt: Uint8Array) {
  if (passphrase.length < 12)
    throw new Error("Use a transfer passphrase with at least 12 characters.");
  const material = await crypto.subtle.importKey(
    "raw",
    buffer(encoder.encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: buffer(salt), iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptTransfer(contents: string, passphrase: string): Promise<string> {
  parseTransferFile(contents);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buffer(iv), additionalData: encoder.encode(PURPOSE) },
    await key(passphrase, salt),
    encoder.encode(contents),
  );
  return JSON.stringify({
    app: PURPOSE,
    format: 1,
    iterations: ITERATIONS,
    salt: base64(salt),
    iv: base64(iv),
    data: base64(new Uint8Array(encrypted)),
  });
}

export async function decryptTransfer(contents: string, passphrase: string): Promise<string> {
  try {
    const value = JSON.parse(contents);
    if (
      value.app !== PURPOSE ||
      value.format !== 1 ||
      value.iterations !== ITERATIONS ||
      typeof value.salt !== "string" ||
      typeof value.iv !== "string" ||
      typeof value.data !== "string"
    )
      throw new Error();
    const salt = decode(value.salt),
      iv = decode(value.iv),
      data = decode(value.data);
    if (salt.length !== 16 || iv.length !== 12 || data.length < 16 || data.length > 3_500_000)
      throw new Error();
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buffer(iv), additionalData: encoder.encode(PURPOSE) },
      await key(passphrase, salt),
      buffer(data),
    );
    const text = new TextDecoder().decode(clear);
    parseTransferFile(text);
    return text;
  } catch {
    throw new Error("Cannot open this encrypted transfer. Check the passphrase and file.");
  }
}
