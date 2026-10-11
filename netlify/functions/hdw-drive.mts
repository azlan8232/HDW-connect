import { createSign, randomUUID } from "node:crypto";
import {
  authenticate,
  fileKind,
  HttpError,
  validateUpload,
  requireFolderEditor,
} from "../lib/drive-security.mts";
import {
  connectOwner,
  ownerAccessToken,
  ownerConnection,
  OWNER_EMAIL,
} from "../lib/drive-owner.mts";

declare const Netlify: { env: { get(name: string): string | undefined } };
const env = (name: string) => Netlify.env.get(name);
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
let cachedToken: { value: string; expires: number } | undefined;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

async function driveToken() {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.value;
  if (env("GOOGLE_DRIVE_AUTH_MODE") !== "service-account") {
    const token = await ownerAccessToken(env);
    cachedToken = {
      value: token.access_token,
      expires: Date.now() + Math.max(0, Math.min(token.expires_in ?? 3600, 3600) - 60) * 1000,
    };
    return cachedToken.value;
  }
  let credential;
  try {
    credential = JSON.parse(env("GOOGLE_SERVICE_ACCOUNT_JSON") ?? "");
  } catch {
    throw new HttpError(503, "The Drive service account is not configured.");
  }
  if (typeof credential.client_email !== "string" || typeof credential.private_key !== "string")
    throw new HttpError(503, "The Drive service account is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: credential.client_email, scope: "https://www.googleapis.com/auth/drive", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const assertion = `${unsigned}.${sign.sign(credential.private_key, "base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new HttpError(502, "Google could not authorize the Drive service account.");
  const token = await response.json();
  cachedToken = { value: token.access_token, expires: Date.now() + 3_000_000 };
  return cachedToken.value;
}

async function drive(path: string, init: RequestInit = {}, upload = false) {
  const response = await fetch(
    `https://www.googleapis.com/${upload ? "upload/" : ""}drive/v3/${path}`,
    {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${await driveToken()}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw new HttpError(
      response.status === 404 ? 404 : 502,
      response.status === 404
        ? "Drive file or folder not found. Check service account access."
        : "Google Drive could not complete the request. Check folder access and try again.",
    );
  return response;
}

export default async function handler(request: Request) {
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.searchParams.get("action") === "config")
      return json({
        clientId: env("GOOGLE_CLIENT_ID") ?? "",
        folderId: env("GOOGLE_DRIVE_FOLDER_ID") ?? "",
      });
    if (!["GET", "POST"].includes(request.method))
      return json({ error: "Method not allowed." }, 405);
    // Signature proves identity; folder permissions below authorize record access.
    const staff = await authenticate(request, env, true);
    const folder = env("GOOGLE_DRIVE_FOLDER_ID") ?? "";
    if (!/^[\w-]+$/.test(folder))
      throw new HttpError(503, "The Drive folder has not been configured.");
    const action = url.searchParams.get("action");
    const authorizeRecords = () =>
      requireFolderEditor(staff.email, async (pageToken) => {
        const params = new URLSearchParams({
          supportsAllDrives: "true",
          pageSize: "100",
          fields: "nextPageToken,permissions(type,role,emailAddress,deleted,expirationTime)",
          ...(pageToken ? { pageToken } : {}),
        });
        return (await drive(`files/${folder}/permissions?${params}`)).json();
      });
    if (request.method === "GET" && action === "session") {
      const ownerMode = env("GOOGLE_DRIVE_AUTH_MODE") !== "service-account";
      if (!staff.administrator) await authorizeRecords();
      return json({
        ...staff,
        ownerMode,
        ownerConnected: ownerMode ? !!(await ownerConnection(env)) : true,
        ownerEmail: OWNER_EMAIL,
        ...(staff.administrator ? { ownerSetupReady: !!env("GOOGLE_CLIENT_SECRET") } : {}),
      });
    }
    if (request.method === "POST" && action === "connect-owner") {
      if (!staff.administrator)
        throw new HttpError(403, "Only an administrator can connect the folder owner.");
      const connected = await connectOwner(request, env);
      cachedToken = undefined;
      return json(connected);
    }
    if (request.method === "GET" && action === "list") {
      await authorizeRecords();
      const page = url.searchParams.get("pageToken") ?? "";
      if (page.length > 2048) throw new HttpError(400, "Invalid page token.");
      const params = new URLSearchParams({
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        q: `'${folder}' in parents and trashed = false and appProperties has { key='app' and value='hdw-connect' }${staff.administrator ? "" : " and appProperties has { key='kind' and value='transfer' }"}`,
        fields: "nextPageToken,files(id,name,createdTime,size,appProperties)",
        pageSize: "100",
        orderBy: "createdTime desc",
        ...(page ? { pageToken: page } : {}),
      });
      return json(await (await drive(`files?${params}`)).json());
    }
    if (request.method === "GET" && action === "download") {
      await authorizeRecords();
      const id = url.searchParams.get("id") ?? "";
      if (!/^[\w-]+$/.test(id)) throw new HttpError(400, "Invalid file ID.");
      const file = await (
        await drive(
          `files/${id}?supportsAllDrives=true&fields=id,name,parents,trashed,size,appProperties`,
        )
      ).json();
      const kind = fileKind(file, folder, staff);
      if (Number(file.size) > 3_500_000)
        throw new HttpError(413, "This file exceeds the app's 3.5 MB limit.");
      const contents = await (await drive(`files/${id}?alt=media&supportsAllDrives=true`)).text();
      validateUpload(kind, contents);
      console.info(
        JSON.stringify({
          event: "hdw-drive-download",
          actor: staff.sub,
          file: id,
          kind,
          at: new Date().toISOString(),
        }),
      );
      return json({ contents, kind });
    }
    if (request.method === "POST" && action === "upload") {
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw new HttpError(415, "Send an HDW CONNECT JSON file.");
      if (Number(request.headers.get("content-length")) > 4_000_000)
        throw new HttpError(413, "The file is too large.");
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 4_000_000) throw new HttpError(413, "The file is too large.");
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "Invalid request.");
      }
      if (body.kind === "backup" && !staff.administrator)
        throw new HttpError(403, "Only administrators can upload full vault backups.");
      validateUpload(body.kind, body.contents);
      await authorizeRecords();
      const folderInfo = await (
        await drive(
          `files/${folder}?supportsAllDrives=true&fields=mimeType,driveId,capabilities(canAddChildren)`,
        )
      ).json();
      if (
        folderInfo.mimeType !== "application/vnd.google-apps.folder" ||
        (env("GOOGLE_DRIVE_AUTH_MODE") === "service-account" && !folderInfo.driveId) ||
        !folderInfo.capabilities?.canAddChildren
      )
        throw new HttpError(
          403,
          env("GOOGLE_DRIVE_AUTH_MODE") === "service-account"
            ? "Choose a Shared drive folder where the service account can add files."
            : "The connected folder owner cannot add files to this folder.",
        );
      const filename = `hdw-${body.kind}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.${body.kind === "backup" ? "hdwbackup" : JSON.parse(body.contents).app === "HDW CONNECT encrypted transfer" ? "hdwtransfer.enc" : "hdwtransfer"}`;
      const metadata = {
        name: filename,
        parents: [folder],
        mimeType: "application/json",
        appProperties: { app: "hdw-connect", kind: body.kind, uploader: staff.sub },
      };
      const boundary = randomUUID();
      const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body.contents}\r\n--${boundary}--`;
      const uploaded = await (
        await drive(
          "files?uploadType=multipart&supportsAllDrives=true&fields=id,name,createdTime,parents,webViewLink,appProperties",
          {
            method: "POST",
            headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
            body: multipart,
          },
          true,
        )
      ).json();
      if (typeof uploaded.id !== "string" || !uploaded.parents?.includes(folder))
        throw new HttpError(
          502,
          "Google did not confirm the destination of the uploaded file. Check Drive before retrying.",
        );
      console.info(
        JSON.stringify({
          event: "hdw-drive-upload",
          actor: staff.sub,
          file: uploaded.id,
          kind: body.kind,
          at: new Date().toISOString(),
        }),
      );
      return json(uploaded, 201);
    }
    throw new HttpError(400, "Unknown Drive action.");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: "The Drive request failed. Try again later." }, 502);
  }
}
