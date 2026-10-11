// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  authenticate,
  authorizeClaims,
  fileKind,
  validateUpload,
  requireFolderEditor,
} from "../../netlify/lib/drive-security.mts";
import handler from "../../netlify/functions/hdw-drive.mts";
import { createTransferFile } from "../lib/hdw/transfer-file";

const values: Record<string, string> = {
  GOOGLE_CLIENT_ID: "test-client",
  HDW_ADMIN_EMAILS: "azlan8232@gmail.com",
  HDW_ALLOWED_EMAILS: "staff@gmail.com",
  GOOGLE_DRIVE_FOLDER_ID: "folder-1",
  GOOGLE_DRIVE_AUTH_MODE: "service-account",
};
const env = (name: string) => values[name];
const claims = (email = "staff@gmail.com") => ({
  aud: "test-client",
  iss: "https://accounts.google.com",
  exp: Date.now() / 1000 + 3600,
  iat: Date.now() / 1000,
  email,
  email_verified: true,
  sub: "staff-identity",
});
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" };
function token(payload: Record<string, unknown>, privateKey = pair.privateKey) {
  const unsigned = [{ alg: "RS256", kid: "test-key" }, payload]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .join(".");
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Drive access boundaries", () => {
  it("requires a valid signature and rejects an altered token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ keys: [jwk] })));
    const request = (value: string) =>
      new Request("https://example.test", { headers: { Authorization: `Bearer ${value}` } });
    await expect(authenticate(request(token(claims())), env)).resolves.toMatchObject({
      email: "staff@gmail.com",
      administrator: false,
    });
    const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await expect(authenticate(request(token(claims(), attacker.privateKey)), env)).rejects.toThrow(
      "Sign in",
    );
  });
  it("rejects wrong audience, expired tokens, unverified email and unapproved users", () => {
    for (const change of [
      { aud: "another-client" },
      { exp: 1 },
      { iss: "attacker" },
      { email_verified: false },
      { email: "unknown@gmail.com" },
    ])
      expect(() => authorizeClaims({ ...claims(), ...change }, "test-client", env)).toThrow();
    expect(authorizeClaims(claims("azlan8232@gmail.com"), "test-client", env).administrator).toBe(
      true,
    );
    expect(() => authorizeClaims(claims(), "test-client", () => undefined)).toThrow();
  });
  it("rejects files outside the folder and prevents staff downloading full backups", () => {
    const staff = authorizeClaims(claims(), "test-client", env);
    const file = {
      parents: ["folder-1"],
      appProperties: { app: "hdw-connect", kind: "transfer" },
      trashed: false,
    };
    expect(fileKind(file, "folder-1", staff)).toBe("transfer");
    expect(() => fileKind({ ...file, parents: ["another-folder"] }, "folder-1", staff)).toThrow(
      "not found",
    );
    expect(() =>
      fileKind(
        { ...file, appProperties: { app: "hdw-connect", kind: "backup" } },
        "folder-1",
        staff,
      ),
    ).toThrow("administrators");
  });
  it("accepts valid passphrase-free transfers, rejects invalid files, and keeps backups encrypted", () => {
    expect(() =>
      validateUpload(
        "transfer",
        createTransferFile([{ id: "synthetic-1", name: "Synthetic patient" }], 6),
      ),
    ).not.toThrow();
    expect(() => validateUpload("backup", createTransferFile([{ id: "synthetic-1" }], 6))).toThrow(
      "encrypted vault backup",
    );
    expect(() =>
      validateUpload(
        "transfer",
        JSON.stringify({ app: "HDW CONNECT record transfer", records: [{ name: "patient" }] }),
      ),
    ).toThrow("supported HDW CONNECT");
    expect(() => validateUpload("backup", "x".repeat(3_500_001))).toThrow("3.5 MB");
    expect(() =>
      validateUpload(
        "transfer",
        JSON.stringify({
          app: "HDW CONNECT encrypted transfer",
          format: 1,
          iterations: 600_000,
          salt: Buffer.alloc(16).toString("base64"),
          iv: Buffer.alloc(12).toString("base64"),
          data: Buffer.alloc(32).toString("base64"),
        }),
      ),
    ).not.toThrow();
  });
  it("does not contact Drive for unauthenticated or unauthorized uploads", async () => {
    vi.stubGlobal("Netlify", { env: { get: env } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const anonymous = await handler(
      new Request("https://example.test/.netlify/functions/hdw-drive?action=list"),
    );
    expect(anonymous.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    const response = await handler(
      new Request("https://example.test/.netlify/functions/hdw-drive?action=upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token(claims())}`, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "backup", contents: "{}" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("uploads passphrase-free content to the fixed Shared drive folder and verifies the parent before download", async () => {
    const credential = {
      client_email: "service@example.test",
      private_key: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    };
    vi.stubGlobal("Netlify", {
      env: {
        get: (name: string) =>
          name === "GOOGLE_SERVICE_ACCOUNT_JSON" ? JSON.stringify(credential) : env(name),
      },
    });
    const contents = createTransferFile([{ id: "synthetic-1", name: "Synthetic patient" }], 6);
    const metadata = {
      id: "file-1",
      parents: ["folder-1"],
      appProperties: { app: "hdw-connect", kind: "transfer" },
      size: String(contents.length),
      trashed: false,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("oauth2/v3/certs")) return Response.json({ keys: [jwk] });
      if (url.includes("oauth2.googleapis.com/token"))
        return Response.json({ access_token: "service-token" });
      if (url.includes("/permissions?"))
        return Response.json({
          permissions: [{ type: "user", role: "writer", emailAddress: "staff@gmail.com" }],
        });
      if (url.includes("files/folder-1"))
        return Response.json({
          mimeType: "application/vnd.google-apps.folder",
          driveId: "shared-drive",
          capabilities: { canAddChildren: true },
        });
      if (url.includes("upload/drive")) {
        expect(init?.body).toContain('"parents":["folder-1"]');
        expect(init?.body).toContain(contents);
        expect(url).toContain("supportsAllDrives=true");
        return Response.json(metadata);
      }
      if (url.includes("alt=media")) return new Response(contents);
      if (url.includes("files/file-1")) return Response.json(metadata);
      throw new Error("Unexpected Google request");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const authorization = `Bearer ${token(claims())}`;
    const uploaded = await handler(
      new Request("https://example.test/.netlify/functions/hdw-drive?action=upload", {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "transfer", contents }),
      }),
    );
    expect(uploaded.status).toBe(201);
    const download = () =>
      handler(
        new Request("https://example.test/.netlify/functions/hdw-drive?action=download&id=file-1", {
          headers: { Authorization: authorization },
        }),
      );
    expect(await (await download()).json()).toEqual({ contents, kind: "transfer" });
    metadata.parents = ["outside-folder"];
    fetchMock.mockClear();
    expect((await download()).status).toBe(404);
    expect(fetchMock.mock.calls.some(([url]) => url.includes("alt=media"))).toBe(false);
  });
});

it("accepts named editors across permission pages and rejects viewers, groups and expired grants", async () => {
  const load = vi.fn(async (page: string) =>
    page
      ? { permissions: [{ type: "user", role: "writer", emailAddress: "staff@gmail.com" }] }
      : { permissions: [{ type: "anyone", role: "writer" }], nextPageToken: "next" },
  );
  await expect(requireFolderEditor("staff@gmail.com", load)).resolves.toBeUndefined();
  expect(load.mock.calls).toEqual([[""], ["next"]]);
  for (const permission of [
    { type: "user", role: "reader", emailAddress: "staff@gmail.com" },
    { type: "group", role: "writer", emailAddress: "staff@gmail.com" },
    { type: "user", role: "writer", emailAddress: "other@gmail.com" },
    { type: "user", role: "writer", emailAddress: "staff@gmail.com", deleted: true },
    {
      type: "user",
      role: "writer",
      emailAddress: "staff@gmail.com",
      expirationTime: "2000-01-01T00:00:00Z",
    },
  ])
    await expect(
      requireFolderEditor("staff@gmail.com", async () => ({ permissions: [permission] })),
    ).rejects.toThrow("Editor");
});
