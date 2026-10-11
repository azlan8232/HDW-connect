import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { HttpError } from "./drive-security.mts";

type Env = (name: string) => string | undefined;
type Connection = { email: string; folder: string; refreshToken: string };
type Envelope = { iv: string; tag: string; data: string };
export const OWNER_EMAIL = "wadhdw25.hkl@moh.gov.my";
export const OWNER_ORIGIN = "https://hdw-connect.netlify.app";
const store = () => getStore({ name: "hdw-drive-owner", consistency: "strong" });
const key = (env: Env) => {
  const secret = env("GOOGLE_CLIENT_SECRET");
  if (!secret)
    throw new HttpError(
      503,
      "Add GOOGLE_CLIENT_SECRET in Netlify and redeploy before connecting the folder owner.",
    );
  return Buffer.from(hkdfSync("sha256", secret, "hdw-drive-owner", "refresh-token-v1", 32));
};
export function sealOwner(connection: Connection, env: Env): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(env), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(connection), "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}
export function openOwner(envelope: Envelope, env: Env): Connection {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(env), Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new HttpError(
      503,
      "The owner's saved authorization cannot be opened. Reconnect the folder owner.",
    );
  }
}
export async function ownerConnection(env: Env): Promise<Connection | null> {
  if (!env("GOOGLE_CLIENT_SECRET")) return null;
  const envelope = (await store().get("connection", { type: "json" })) as Envelope | null;
  if (!envelope) return null;
  const connection = openOwner(envelope, env);
  if (connection.email !== OWNER_EMAIL || connection.folder !== env("GOOGLE_DRIVE_FOLDER_ID"))
    return null;
  return connection;
}
export async function googleTokens(body: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new HttpError(
      503,
      "Google could not authorize the folder owner. Check the OAuth client settings or reconnect the owner.",
    );
  const result = await response.json();
  if (typeof result.access_token !== "string")
    throw new HttpError(502, "Google returned an invalid authorization response.");
  return result as { access_token: string; refresh_token?: string; expires_in?: number };
}
export async function connectOwner(request: Request, env: Env) {
  if (
    request.headers.get("origin") !== OWNER_ORIGIN ||
    request.headers.get("x-hdw-owner-connect") !== "1"
  )
    throw new HttpError(403, "Open the owner connection from the HDW CONNECT website.");
  if (["deploy-preview", "branch-deploy"].includes(env("CONTEXT") ?? ""))
    throw new HttpError(403, "Connect the owner from the production website.");
  key(env);
  const raw = await request.text();
  if (raw.length > 12_000) throw new HttpError(400, "Invalid owner authorization.");
  let code: unknown;
  try {
    code = JSON.parse(raw).code;
  } catch {
    throw new HttpError(400, "Invalid owner authorization.");
  }
  if (typeof code !== "string" || !code || code.length > 8_000)
    throw new HttpError(400, "Invalid owner authorization.");
  const tokens = await googleTokens(
    new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: env("GOOGLE_CLIENT_ID") ?? "",
      client_secret: env("GOOGLE_CLIENT_SECRET")!,
      redirect_uri: OWNER_ORIGIN,
    }),
  );
  const folder = env("GOOGLE_DRIVE_FOLDER_ID")!;
  const googleGet = async (path: string) => {
    const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new HttpError(
        403,
        "The selected Google account cannot access the configured folder. Approve the requested Drive access.",
      );
    return response.json();
  };
  const account = await googleGet("about?fields=user(emailAddress)");
  if (account.user?.emailAddress?.toLowerCase() !== OWNER_EMAIL)
    throw new HttpError(403, `Choose the folder owner's Google account: ${OWNER_EMAIL}.`);
  const info = await googleGet(
    `files/${folder}?supportsAllDrives=true&fields=id,name,mimeType,owners(emailAddress),capabilities(canAddChildren)`,
  );
  if (
    info.mimeType !== "application/vnd.google-apps.folder" ||
    !info.capabilities?.canAddChildren ||
    !info.owners?.some(
      (owner: { emailAddress?: string }) => owner.emailAddress?.toLowerCase() === OWNER_EMAIL,
    )
  )
    throw new HttpError(403, "The owner must be able to add files to the configured folder.");
  if (!tokens.refresh_token)
    throw new HttpError(
      409,
      "Google did not grant ongoing access. Remove HDW CONNECT from the owner's Google account connections, then connect again.",
    );
  await store().setJSON(
    "connection",
    sealOwner({ email: OWNER_EMAIL, folder, refreshToken: tokens.refresh_token }, env),
  );
  return { connected: true, ownerEmail: OWNER_EMAIL, folderName: info.name };
}
export async function ownerAccessToken(env: Env) {
  const connection = await ownerConnection(env);
  if (!connection)
    throw new HttpError(
      503,
      "The folder owner has not connected Google Drive. Ask an administrator to connect the folder owner.",
    );
  return googleTokens(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
      client_id: env("GOOGLE_CLIENT_ID") ?? "",
      client_secret: env("GOOGLE_CLIENT_SECRET")!,
    }),
  );
}
