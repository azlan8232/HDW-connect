const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const VAULT_KDF_ITERATIONS = 600_000;

export interface Ciphertext {
  iv: string;
  data: string;
}

export interface VaultAccount {
  id: string;
  name: string;
  role: "administrator" | "clinician";
  salt: string;
  publicKey: JsonWebKey;
  privateKey: Ciphertext;
  wrappedKey: string;
}

export interface VaultEnvelope {
  app: "HDW CONNECT encrypted vault";
  format: 2;
  schema: number;
  createdAt: string;
  updatedAt: string;
  accounts: VaultAccount[];
  recovery: { salt: string; wrappedKey: Ciphertext };
  records: Ciphertext;
}

export interface UnlockedVault {
  key: CryptoKey;
  records: unknown;
  envelope: VaultEnvelope;
  account: VaultAccount;
}

function cryptoApi(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error("Secure encryption is unavailable. Open HDW CONNECT from a secure local app or HTTPS context.");
  }
  return globalThis.crypto;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function validBase64(value: unknown, minimumBytes = 1, maximumBytes = 50_000_000): value is string {
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return false;
  try { const decoded = fromBase64(value); return decoded.byteLength >= minimumBytes && decoded.byteLength <= maximumBytes; }
  catch { return false; }
}

function validCiphertext(value: unknown, label: string, minimumDataBytes = 16): asserts value is Ciphertext {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const candidate = value as Partial<Ciphertext>;
  if (!validBase64(candidate.iv, 12, 12) || !validBase64(candidate.data, minimumDataBytes)) throw new Error(`${label} is invalid.`);
}

export function randomId(bytes = 16): string {
  const value = new Uint8Array(bytes);
  cryptoApi().getRandomValues(value);
  return toBase64(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function makeRecoveryCode(): string {
  const raw = randomId(32);
  return raw.match(/.{1,4}/gu)?.join("-") ?? raw;
}

function randomBytes(length = 16): Uint8Array {
  const result = new Uint8Array(length);
  cryptoApi().getRandomValues(result);
  return result;
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function normaliseRecoveryCode(code: string): string {
  return code.replaceAll("-", "").replaceAll(" ", "").trim();
}

async function deriveWrappingKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await cryptoApi().subtle.importKey("raw", asBufferSource(encoder.encode(secret)), "PBKDF2", false, ["deriveKey"]);
  return cryptoApi().subtle.deriveKey(
    { name: "PBKDF2", salt: asBufferSource(salt), iterations: VAULT_KDF_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptBytes(bytes: Uint8Array, key: CryptoKey, purpose: string): Promise<Ciphertext> {
  const iv = randomBytes(12);
  const encrypted = await cryptoApi().subtle.encrypt({ name: "AES-GCM", iv: asBufferSource(iv), additionalData: asBufferSource(encoder.encode(purpose)) }, key, asBufferSource(bytes));
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(encrypted)) };
}

async function decryptBytes(ciphertext: Ciphertext, key: CryptoKey, purpose: string): Promise<Uint8Array> {
  const clear = await cryptoApi().subtle.decrypt({
    name: "AES-GCM",
    iv: asBufferSource(fromBase64(ciphertext.iv)),
    additionalData: asBufferSource(encoder.encode(purpose)),
  }, key, asBufferSource(fromBase64(ciphertext.data)));
  return new Uint8Array(clear);
}

function newVaultKey(): Promise<CryptoKey> {
  return cryptoApi().subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function wrapVaultKey(key: CryptoKey, wrappingKey: CryptoKey, purpose: string): Promise<Ciphertext> {
  const raw = new Uint8Array(await cryptoApi().subtle.exportKey("raw", key));
  return encryptBytes(raw, wrappingKey, purpose);
}

async function unwrapVaultKey(ciphertext: Ciphertext, wrappingKey: CryptoKey, purpose: string): Promise<CryptoKey> {
  const raw = await decryptBytes(ciphertext, wrappingKey, purpose);
  return cryptoApi().subtle.importKey("raw", asBufferSource(raw), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

async function encryptRecords(records: unknown, key: CryptoKey): Promise<Ciphertext> {
  return encryptBytes(encoder.encode(JSON.stringify(records)), key, "hdw-connect-records-v1");
}

async function decryptRecords(ciphertext: Ciphertext, key: CryptoKey): Promise<unknown> {
  const raw = await decryptBytes(ciphertext, key, "hdw-connect-records-v1");
  return JSON.parse(decoder.decode(raw)) as unknown;
}

function newAccountId(): string {
  return randomId(12);
}

async function makeAccount(name: string, password: string, role: VaultAccount["role"], vaultKey: CryptoKey): Promise<VaultAccount> {
  const id = newAccountId();
  if (!name.trim()) throw new Error("Enter the clinician name.");
  if (password.length < 12) throw new Error("Use a passphrase with at least 12 characters.");
  const pair = await cryptoApi().subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  const publicKey = await cryptoApi().subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await cryptoApi().subtle.exportKey("jwk", pair.privateKey);
  const salt = randomBytes(16);
  const wrappingKey = await deriveWrappingKey(password, salt);
  const rawVaultKey = new Uint8Array(await cryptoApi().subtle.exportKey("raw", vaultKey));
  return {
    id,
    name: name.trim(),
    role,
    salt: toBase64(salt),
    publicKey,
    privateKey: await encryptBytes(encoder.encode(JSON.stringify(privateJwk)), wrappingKey, `hdw-connect-account-private-key:${id}`),
    wrappedKey: toBase64(new Uint8Array(await cryptoApi().subtle.encrypt({ name: "RSA-OAEP" }, pair.publicKey, rawVaultKey))),
  };
}

async function unwrapAccountVaultKey(account: VaultAccount, password: string): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(password, fromBase64(account.salt));
  const privateJson = await decryptBytes(account.privateKey, wrappingKey, `hdw-connect-account-private-key:${account.id}`);
  const privateJwk = JSON.parse(decoder.decode(privateJson)) as JsonWebKey;
  const privateKey = await cryptoApi().subtle.importKey("jwk", privateJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
  const raw = await cryptoApi().subtle.decrypt({ name: "RSA-OAEP" }, privateKey, asBufferSource(fromBase64(account.wrappedKey)));
  return cryptoApi().subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

async function wrapVaultKeyForAccount(key: CryptoKey, account: VaultAccount): Promise<string> {
  const publicKey = await cryptoApi().subtle.importKey("jwk", account.publicKey, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const raw = new Uint8Array(await cryptoApi().subtle.exportKey("raw", key));
  return toBase64(new Uint8Array(await cryptoApi().subtle.encrypt({ name: "RSA-OAEP" }, publicKey, asBufferSource(raw))));
}

export async function createVault(name: string, password: string, records: unknown, schema: number) {
  if (!name.trim()) throw new Error("Enter the clinician name for this device account.");
  if (password.length < 12) throw new Error("Use a passphrase with at least 12 characters.");
  const vaultKey = await newVaultKey();
  const account = await makeAccount(name, password, "administrator", vaultKey);
  const recoveryCode = makeRecoveryCode();
  const recoverySalt = randomBytes(16);
  const recoveryWrappingKey = await deriveWrappingKey(normaliseRecoveryCode(recoveryCode), recoverySalt);
  const timestamp = new Date().toISOString();
  const envelope: VaultEnvelope = {
    app: "HDW CONNECT encrypted vault",
    format: 2,
    schema,
    createdAt: timestamp,
    updatedAt: timestamp,
    accounts: [account],
    recovery: {
      salt: toBase64(recoverySalt),
      wrappedKey: await wrapVaultKey(vaultKey, recoveryWrappingKey, "hdw-connect-recovery-key"),
    },
    records: await encryptRecords(records, vaultKey),
  };
  return { envelope, unlocked: { key: vaultKey, records, envelope, account } satisfies UnlockedVault, recoveryCode };
}

export async function unlockVault(envelope: VaultEnvelope, name: string, password: string): Promise<UnlockedVault> {
  const account = envelope.accounts.find((entry) => entry.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
  if (!account) throw new Error("Account name or passphrase is incorrect.");
  try {
    const key = await unwrapAccountVaultKey(account, password);
    const records = await decryptRecords(envelope.records, key);
    return { key, records, envelope, account };
  } catch {
    throw new Error("Account name or passphrase is incorrect.");
  }
}

export async function recoverVault(envelope: VaultEnvelope, accountName: string, recoveryCode: string, newPassword: string) {
  if (newPassword.length < 12) throw new Error("Use a passphrase with at least 12 characters.");
  try {
    const recoveryKey = await deriveWrappingKey(normaliseRecoveryCode(recoveryCode), fromBase64(envelope.recovery.salt));
    const vaultKey = await unwrapVaultKey(envelope.recovery.wrappedKey, recoveryKey, "hdw-connect-recovery-key");
    const records = await decryptRecords(envelope.records, vaultKey);
    const previous = envelope.accounts.find((entry) => entry.name.toLocaleLowerCase() === accountName.trim().toLocaleLowerCase());
    const account = await makeAccount(accountName, newPassword, previous?.role ?? "administrator", vaultKey);
    const nextRecoveryCode = makeRecoveryCode();
    const recoverySalt = randomBytes(16);
    const recoveryWrappingKey = await deriveWrappingKey(normaliseRecoveryCode(nextRecoveryCode), recoverySalt);
    const nextEnvelope: VaultEnvelope = {
      ...envelope,
      updatedAt: new Date().toISOString(),
      accounts: previous ? envelope.accounts.map((entry) => entry.id === previous.id ? account : entry) : [...envelope.accounts, account],
      recovery: { salt: toBase64(recoverySalt), wrappedKey: await wrapVaultKey(vaultKey, recoveryWrappingKey, "hdw-connect-recovery-key") },
    };
    return { envelope: nextEnvelope, unlocked: { key: vaultKey, records, envelope: nextEnvelope, account } satisfies UnlockedVault, recoveryCode: nextRecoveryCode };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Use a passphrase")) throw error;
    throw new Error("Recovery key is incorrect or this vault is damaged.");
  }
}

export async function addVaultAccount(envelope: VaultEnvelope, vaultKey: CryptoKey, name: string, password: string) {
  if (!name.trim()) throw new Error("Enter the clinician name.");
  if (password.length < 12) throw new Error("Use a passphrase with at least 12 characters.");
  if (envelope.accounts.some((entry) => entry.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())) {
    throw new Error("An account with this name already exists.");
  }
  return { ...envelope, updatedAt: new Date().toISOString(), accounts: [...envelope.accounts, await makeAccount(name, password, "clinician", vaultKey)] };
}

export async function removeVaultAccount(envelope: VaultEnvelope, key: CryptoKey, records: unknown, accountId: string, recoveryCode: string) {
  const removed = envelope.accounts.find((account) => account.id === accountId);
  if (!removed || removed.role === "administrator") throw new Error("Administrator accounts cannot be removed from this device.");
  const accounts = envelope.accounts.filter((account) => account.id !== accountId);
  if (!accounts.some((account) => account.role === "administrator")) throw new Error("At least one administrator account must remain.");
  const nextKey = await newVaultKey();
  const wrappedAccounts = await Promise.all(accounts.map(async (account) => ({ ...account, wrappedKey: await wrapVaultKeyForAccount(nextKey, account) })));
  const nextRecoveryCode = makeRecoveryCode();
  const recoverySalt = randomBytes(16);
  const recoveryWrappingKey = await deriveWrappingKey(normaliseRecoveryCode(nextRecoveryCode), recoverySalt);
  const oldRecoveryKey = await deriveWrappingKey(normaliseRecoveryCode(recoveryCode), fromBase64(envelope.recovery.salt));
  const recoveredKey = await unwrapVaultKey(envelope.recovery.wrappedKey, oldRecoveryKey, "hdw-connect-recovery-key");
  const recoveryRecords = await decryptRecords(envelope.records, recoveredKey);
  if (JSON.stringify(recoveryRecords) !== JSON.stringify(records)) throw new Error("The recovery key does not match this vault.");
  const nextEnvelope: VaultEnvelope = {
    ...envelope,
    updatedAt: new Date().toISOString(),
    accounts: wrappedAccounts,
    recovery: { salt: toBase64(recoverySalt), wrappedKey: await wrapVaultKey(nextKey, recoveryWrappingKey, "hdw-connect-recovery-key") },
    records: await encryptRecords(records, nextKey),
  };
  return { envelope: nextEnvelope, key: nextKey, recoveryCode: nextRecoveryCode };
}

export async function saveVaultRecords(envelope: VaultEnvelope, key: CryptoKey, records: unknown): Promise<VaultEnvelope> {
  return { ...envelope, updatedAt: new Date().toISOString(), records: await encryptRecords(records, key) };
}

export function parseVaultEnvelope(text: string): VaultEnvelope {
  if (text.length > 50_000_000) throw new Error("The encrypted vault is too large to open on this device.");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("This is not an HDW CONNECT encrypted vault.");
  const candidate = value as Partial<VaultEnvelope>;
  if (candidate.app !== "HDW CONNECT encrypted vault" || candidate.format !== 2 || !Number.isInteger(candidate.schema) || Number(candidate.schema) < 1 || !Array.isArray(candidate.accounts) || !candidate.accounts.length || candidate.accounts.length > 100 || !candidate.recovery || !candidate.records || typeof candidate.createdAt !== "string" || typeof candidate.updatedAt !== "string") {
    throw new Error("This is not a supported HDW CONNECT encrypted vault.");
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const account of candidate.accounts) {
    if (!account || typeof account.name !== "string" || !account.name.trim() || typeof account.id !== "string" || !account.id || !["administrator", "clinician"].includes(account.role) || !validBase64(account.salt, 16, 16) || !validBase64(account.wrappedKey, 384, 384) || !account.publicKey || account.publicKey.kty !== "RSA" || typeof account.publicKey.n !== "string" || typeof account.publicKey.e !== "string") {
      throw new Error("The encrypted vault has invalid account data.");
    }
    validCiphertext(account.privateKey, "Encrypted account key");
    if (ids.has(account.id) || names.has(account.name.toLocaleLowerCase())) throw new Error("The encrypted vault has duplicate clinician accounts.");
    ids.add(account.id);
    names.add(account.name.toLocaleLowerCase());
  }
  validCiphertext(candidate.records, "Encrypted records");
  if (!validBase64(candidate.recovery.salt, 16, 16)) throw new Error("The encrypted vault is incomplete.");
  validCiphertext(candidate.recovery.wrappedKey, "Recovery key wrapper", 32);
  return candidate as VaultEnvelope;
}
