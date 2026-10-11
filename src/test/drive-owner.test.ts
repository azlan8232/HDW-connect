// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  connectOwner,
  openOwner,
  sealOwner,
  OWNER_EMAIL,
  OWNER_ORIGIN,
} from "../../netlify/lib/drive-owner.mts";
import handler from "../../netlify/functions/hdw-drive.mts";
import { createTransferFile } from "../lib/hdw/transfer-file";

const blobs = vi.hoisted(() => ({ value: null as unknown, get: vi.fn(), setJSON: vi.fn() }));
vi.mock("@netlify/blobs", () => ({ getStore: () => ({ get: blobs.get, setJSON: blobs.setJSON }) }));
const settings: Record<string, string> = {
  GOOGLE_CLIENT_ID: "owner-client",
  GOOGLE_CLIENT_SECRET: "synthetic-client-secret",
  GOOGLE_DRIVE_FOLDER_ID: "fixed-folder",
  HDW_ADMIN_EMAILS: "admin@gmail.com",
  HDW_ALLOWED_EMAILS: "staff@gmail.com",
};
const env = (name: string) => settings[name];
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "owner-key" };
function staffToken(email = "admin@gmail.com") {
  const unsigned = [
    { alg: "RS256", kid: "owner-key" },
    {
      aud: "owner-client",
      iss: "https://accounts.google.com",
      exp: Date.now() / 1000 + 3600,
      iat: Date.now() / 1000,
      email,
      email_verified: true,
      sub: "synthetic-user",
    },
  ]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
    .join(".");
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), pair.privateKey).toString("base64url")}`;
}
function request(action: string, body?: unknown, email = "admin@gmail.com") {
  return new Request(`${OWNER_ORIGIN}/.netlify/functions/hdw-drive?action=${action}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${staffToken(email)}`,
      Origin: OWNER_ORIGIN,
      "Content-Type": "application/json",
      "X-HDW-Owner-Connect": "1",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  blobs.value = null;
});
it("encrypts owner authorization and rejects tampering or a different client secret", () => {
  const connection = {
    email: OWNER_EMAIL,
    folder: "fixed-folder",
    refreshToken: "synthetic-refresh-token",
  };
  const sealed = sealOwner(connection, env);
  expect(JSON.stringify(sealed)).not.toContain(connection.refreshToken);
  expect(openOwner(sealed, env)).toEqual(connection);
  expect(() => openOwner({ ...sealed, tag: Buffer.alloc(16).toString("base64") }, env)).toThrow(
    "cannot be opened",
  );
  expect(() => openOwner(sealed, () => "wrong-secret")).toThrow("cannot be opened");
});
it("rejects foreign origins and the wrong Google account without saving a connection", async () => {
  await expect(
    connectOwner(
      new Request(`${OWNER_ORIGIN}/connect`, {
        method: "POST",
        headers: { Origin: "https://other.test", "X-HDW-Owner-Connect": "1" },
        body: '{"code":"test"}',
      }),
      env,
    ),
  ).rejects.toThrow("website");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/token")
        ? Response.json({ access_token: "owner-access", refresh_token: "owner-refresh" })
        : Response.json({ user: { emailAddress: "wrong@gmail.com" } }),
    ),
  );
  await expect(connectOwner(request("connect-owner", { code: "test" }), env)).rejects.toThrow(
    "folder owner's Google account",
  );
  expect(blobs.setJSON).not.toHaveBeenCalled();
});
it("blocks staff from connecting the owner before exchanging a Google code", async () => {
  vi.stubGlobal("Netlify", { env: { get: env } });
  const network = vi.fn(async () => Response.json({ keys: [jwk] }));
  vi.stubGlobal("fetch", network);
  const result = await handler(request("connect-owner", { code: "test" }, "staff@gmail.com"));
  expect(result.status).toBe(403);
  expect(network.mock.calls.length).toBeLessThanOrEqual(1);
  expect(blobs.setJSON).not.toHaveBeenCalled();
});
it("connects the owner, renews access server-side, and verifies a My Drive upload destination", async () => {
  blobs.get.mockImplementation(async () => blobs.value);
  blobs.setJSON.mockImplementation(async (_key, value) => {
    blobs.value = value;
  });
  vi.stubGlobal("Netlify", { env: { get: env } });
  vi.spyOn(console, "info").mockImplementation(() => {});
  const contents = createTransferFile([{ id: "synthetic-patient" }], 6);
  let uploadedParents = ["fixed-folder"];
  let editorEmail = "admin@gmail.com";
  const network = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("oauth2/v3/certs")) return Response.json({ keys: [jwk] });
    if (url.includes("/token")) {
      const fields = init?.body as URLSearchParams;
      expect(fields.get("client_secret")).toBe(settings["GOOGLE_CLIENT_SECRET"]);
      if (fields.get("grant_type") === "authorization_code") {
        expect(fields.get("redirect_uri")).toBe(OWNER_ORIGIN);
        return Response.json({ access_token: "owner-access", refresh_token: "owner-refresh" });
      }
      expect(fields.get("refresh_token")).toBe("owner-refresh");
      return Response.json({ access_token: "renewed-owner-access", expires_in: 3600 });
    }
    if (url.includes("about?")) return Response.json({ user: { emailAddress: OWNER_EMAIL } });
    if (url.includes("/permissions?"))
      return Response.json({
        permissions: [{ type: "user", role: "writer", emailAddress: editorEmail }],
      });
    if (url.includes("files/fixed-folder"))
      return Response.json({
        id: "fixed-folder",
        name: "Existing folder",
        mimeType: "application/vnd.google-apps.folder",
        owners: [{ emailAddress: OWNER_EMAIL }],
        capabilities: { canAddChildren: true },
      });
    if (url.includes("upload/drive")) {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer renewed-owner-access" });
      expect(init?.body).toContain('"parents":["fixed-folder"]');
      return Response.json({
        id: "new-file",
        name: "new-transfer.hdwtransfer",
        parents: uploadedParents,
        webViewLink: "https://drive.google.com/file/d/new-file/view",
      });
    }
    throw new Error("Unexpected Google request");
  });
  vi.stubGlobal("fetch", network);
  const connected = await handler(request("connect-owner", { code: "synthetic-code" }));
  expect(connected.status).toBe(200);
  expect(JSON.stringify(await connected.json())).not.toContain("owner-refresh");
  expect(JSON.stringify(blobs.value)).not.toContain("owner-refresh");
  const session = await handler(request("session"));
  expect(await session.json()).toMatchObject({ ownerConnected: true, ownerMode: true });
  const upload = await handler(request("upload", { kind: "transfer", contents }));
  expect(upload.status).toBe(201);
  expect(await upload.json()).toMatchObject({
    parents: ["fixed-folder"],
    webViewLink: "https://drive.google.com/file/d/new-file/view",
  });
  uploadedParents = ["wrong-folder"];
  const wrongDestination = await handler(request("upload", { kind: "transfer", contents }));
  expect(wrongDestination.status).toBe(502);
  expect(await wrongDestination.json()).toMatchObject({
    error: expect.stringContaining("did not confirm the destination"),
  });
  uploadedParents = ["fixed-folder"];
  editorEmail = "new-editor@gmail.com";
  const editorSession = await handler(request("session", undefined, editorEmail));
  expect(editorSession.status).toBe(200);
  const editorUpload = await handler(
    request("upload", { kind: "transfer", contents }, editorEmail),
  );
  expect(editorUpload.status).toBe(201);
  editorEmail = "admin@gmail.com";
  const before = network.mock.calls.filter(([url]) => url.includes("upload/drive")).length;
  const revoked = await handler(
    request("upload", { kind: "transfer", contents }, "new-editor@gmail.com"),
  );
  expect(revoked.status).toBe(403);
  expect(network.mock.calls.filter(([url]) => url.includes("upload/drive"))).toHaveLength(before);
});
