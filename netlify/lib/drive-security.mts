import { createPublicKey, verify } from "node:crypto";
import { parseVaultEnvelope } from "../../src/lib/hdw/vault-crypto.ts";
import { parseTransferFile } from "../../src/lib/hdw/transfer-file.ts";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Staff = { email: string; sub: string; administrator: boolean };
type Env = (name: string) => string | undefined;
let keyCache: { keys: Record<string, unknown>[]; expires: number } | undefined;

export function authorizeClaims(
  claims: Record<string, unknown>,
  clientId: string,
  env: Env,
  folderEditors = false,
): Staff {
  const now = Date.now() / 1000;
  if (
    claims["aud"] !== clientId ||
    !["accounts.google.com", "https://accounts.google.com"].includes(String(claims["iss"])) ||
    typeof claims["exp"] !== "number" ||
    claims["exp"] <= now ||
    typeof claims["iat"] !== "number" ||
    claims["iat"] > now + 60 ||
    claims["email_verified"] !== true ||
    typeof claims["sub"] !== "string" ||
    !claims["sub"] ||
    typeof claims["email"] !== "string"
  )
    throw new HttpError(401, "Sign in to Google again.");
  const email = claims["email"].toLowerCase();
  // Google is authoritative for Gmail and verified Workspace domains.
  if (!email.endsWith("@gmail.com") && typeof claims["hd"] !== "string")
    throw new HttpError(403, "Use a Gmail or Google Workspace account.");
  const emails = (name: string) =>
    (env(name) ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  const administrator = emails("HDW_ADMIN_EMAILS").includes(email);
  if (!folderEditors && !administrator && !emails("HDW_ALLOWED_EMAILS").includes(email))
    throw new HttpError(403, "This Google account has not been approved for Drive access.");
  return { email, sub: claims["sub"], administrator };
}

export async function authenticate(
  request: Request,
  env: Env,
  folderEditors = false,
): Promise<Staff> {
  const clientId = env("GOOGLE_CLIENT_ID");
  if (!clientId) throw new HttpError(503, "Google sign-in has not been configured.");
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
  if (!token || token.length > 12_000)
    throw new HttpError(401, "Sign in with Google to access Drive.");
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error();
    if (!keyCache || keyCache.expires < Date.now()) {
      const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new HttpError(503, "Google sign-in verification is temporarily unavailable.");
      const body = await response.json();
      keyCache = { keys: body.keys, expires: Date.now() + 300_000 };
    }
    const jwk = keyCache.keys.find(
      (entry) => entry["kid"] === header.kid && entry["kty"] === "RSA",
    );
    if (
      !jwk ||
      !verify(
        "RSA-SHA256",
        Buffer.from(`${parts[0]}.${parts[1]}`),
        createPublicKey({ key: jwk, format: "jwk" }),
        Buffer.from(parts[2]!, "base64url"),
      )
    )
      throw new Error();
    return authorizeClaims(
      JSON.parse(Buffer.from(parts[1]!, "base64url").toString()),
      clientId,
      env,
      folderEditors,
    );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "Sign in to Google again.");
  }
}

export async function requireFolderEditor(
  email: string,
  loadPage: (
    pageToken: string,
  ) => Promise<{
    permissions?: Array<{
      type?: string;
      role?: string;
      emailAddress?: string;
      deleted?: boolean;
      expirationTime?: string;
    }>;
    nextPageToken?: string;
  }>,
) {
  let pageToken = "";
  const seen = new Set<string>();
  do {
    if (seen.has(pageToken))
      throw new HttpError(502, "Google folder permissions could not be checked. Try again.");
    seen.add(pageToken);
    const page = await loadPage(pageToken);
    if (
      page.permissions?.some(
        (permission) =>
          permission.type === "user" &&
          !permission.deleted &&
          permission.emailAddress?.toLowerCase() === email.toLowerCase() &&
          ["owner", "writer", "organizer", "fileOrganizer"].includes(permission.role ?? "") &&
          (!permission.expirationTime || Date.parse(permission.expirationTime) > Date.now()),
      )
    )
      return;
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  throw new HttpError(
    403,
    "Ask the folder owner to share the configured Google Drive folder directly with your Google email as an Editor, then sign in again. Group or link access is not supported.",
  );
}

export function fileKind(
  file: Record<string, unknown>,
  folder: string,
  staff: Staff,
): "backup" | "transfer" {
  const properties = file["appProperties"] as Record<string, unknown> | undefined;
  if (
    file["trashed"] ||
    !Array.isArray(file["parents"]) ||
    !file["parents"].includes(folder) ||
    properties?.["app"] !== "hdw-connect" ||
    !["backup", "transfer"].includes(String(properties["kind"]))
  )
    throw new HttpError(404, "File not found in the configured HDW CONNECT folder.");
  if (properties["kind"] === "backup" && !staff.administrator)
    throw new HttpError(403, "Only administrators can access full vault backups.");
  return properties["kind"] as "backup" | "transfer";
}

export function validateUpload(kind: unknown, contents: unknown): asserts contents is string {
  if (kind !== "backup" && kind !== "transfer")
    throw new HttpError(400, "Choose a backup or transfer.");
  if (typeof contents !== "string" || Buffer.byteLength(contents) > 3_500_000)
    throw new HttpError(413, "The file must be smaller than 3.5 MB.");
  try {
    const value = JSON.parse(contents);
    const validBase64 = (text: unknown, minimum: number, exact?: number) =>
      typeof text === "string" &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text) &&
      Buffer.from(text, "base64").length >= minimum &&
      (exact === undefined || Buffer.from(text, "base64").length === exact);
    if (kind === "transfer") {
      if (value.app === "HDW CONNECT record transfer") {
        const transfer = parseTransferFile(contents);
        if (
          !transfer.records.length ||
          transfer.records.some(
            (record) =>
              !record ||
              typeof record !== "object" ||
              Array.isArray(record) ||
              typeof (record as { id?: unknown }).id !== "string" ||
              !(record as { id: string }).id,
          )
        )
          throw new Error();
        if (
          Object.keys(value).some(
            (field) => !["app", "format", "schema", "createdAt", "records"].includes(field),
          )
        )
          throw new Error();
        return;
      }
      if (
        value.app !== "HDW CONNECT encrypted transfer" ||
        value.format !== 1 ||
        value.iterations !== 600_000 ||
        !validBase64(value.salt, 16, 16) ||
        !validBase64(value.iv, 12, 12) ||
        !validBase64(value.data, 16)
      )
        throw new Error();
      if (
        Object.keys(value).some(
          (field) => !["app", "format", "iterations", "salt", "iv", "data"].includes(field),
        )
      )
        throw new Error();
    } else {
      parseVaultEnvelope(contents);
      if (
        value.app !== "HDW CONNECT encrypted vault" ||
        value.format !== 2 ||
        !validBase64(value.records?.iv, 12, 12) ||
        !validBase64(value.records?.data, 16) ||
        !Array.isArray(value.accounts) ||
        !value.recovery
      )
        throw new Error();
      if (
        Object.keys(value).some(
          (field) =>
            ![
              "app",
              "format",
              "schema",
              "createdAt",
              "updatedAt",
              "accounts",
              "recovery",
              "records",
            ].includes(field),
        )
      )
        throw new Error();
    }
  } catch {
    throw new HttpError(400, "Upload a supported HDW CONNECT transfer or encrypted vault backup.");
  }
}
