import { useEffect, useRef, useState } from "react";
import { createTransferPackage, exportBackup } from "@/lib/hdw/store";
import { decryptTransfer } from "@/lib/hdw/encrypted-transfer";

type Staff = {
  email: string;
  administrator: boolean;
  ownerMode?: boolean;
  ownerConnected?: boolean;
  ownerEmail?: string;
  ownerSetupReady?: boolean;
};
type DriveFile = {
  id: string;
  name: string;
  createdTime: string;
  appProperties: { kind: "backup" | "transfer" };
};
type Identity = {
  initialize(options: {
    client_id: string;
    callback: (response: { credential: string }) => void;
  }): void;
  renderButton(element: HTMLElement, options: { theme: string; size: string }): void;
  disableAutoSelect(): void;
};
declare global {
  interface Window {
    google?: {
      accounts: {
        id: Identity;
        oauth2?: {
          initCodeClient(options: {
            client_id: string;
            scope: string;
            ux_mode: "popup";
            hint: string;
            callback: (response: { code?: string; error?: string }) => void;
            error_callback: () => void;
          }): { requestCode(): void };
        };
      };
    };
  }
}
const ENDPOINT = "/.netlify/functions/hdw-drive";
let googleScript: Promise<void> | undefined;
function loadGoogle() {
  if (window.google?.accounts.id) return Promise.resolve();
  if (!googleScript)
    googleScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      const timer = setTimeout(() => {
        script.remove();
        googleScript = undefined;
        reject(
          new Error("Google sign-in did not load. Check your connection and reload this page."),
        );
      }, 15_000);
      script.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        googleScript = undefined;
        reject(new Error("Google sign-in is unavailable. Reconnect and reload this page."));
      };
      document.head.append(script);
    });
  return googleScript;
}

async function api(action: string, credential: string, init: RequestInit = {}) {
  const response = await fetch(`${ENDPOINT}?${action}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential}`,
      ...init.headers,
    },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The Drive backend is unavailable on this deployment.");
  }
  if (!response.ok)
    throw new Error(
      body.error ?? "Drive request failed. Sign in again if your session has expired.",
    );
  return body;
}

export function DrivePanel({
  selectedIds,
  onTransfer,
  onBackup,
}: {
  selectedIds: string[];
  onTransfer: (contents: string) => Promise<void>;
  onBackup: (contents: string) => void;
}) {
  const [token, setToken] = useState("");
  const [staff, setStaff] = useState<Staff | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [pageToken, setPageToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [clientId, setClientId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [receipt, setReceipt] = useState<{ name: string; url?: string } | null>(null);
  const button = useRef<HTMLDivElement>(null);
  const identity = useRef(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`${ENDPOINT}?action=config`, { cache: "no-store" });
        if (!response.ok) throw new Error("The Drive backend is unavailable on this deployment.");
        let config;
        try {
          config = await response.json();
        } catch {
          throw new Error("The Drive backend is unavailable on this deployment.");
        }
        if (!config.clientId)
          throw new Error("Google Drive sign-in is awaiting administrator setup.");
        await loadGoogle();
        if (!active || !button.current) return;
        setClientId(config.clientId);
        setFolderId(/^[\w-]+$/.test(config.folderId ?? "") ? config.folderId : "");
        window.google!.accounts.id.initialize({
          client_id: config.clientId,
          callback: ({ credential }) => {
            const generation = ++identity.current;
            void (async () => {
              setBusy(true);
              try {
                const session = await api("action=session", credential);
                if (!active || identity.current !== generation) return;
                setToken(credential);
                setStaff(session);
                setMessage("");
                if (session.ownerMode && !session.ownerConnected) return;
                const list = await api("action=list", credential);
                if (!active || identity.current !== generation) return;
                setFiles(list.files ?? []);
                setPageToken(list.nextPageToken ?? "");
              } catch (error) {
                if (active) setMessage((error as Error).message);
              } finally {
                if (active) setBusy(false);
              }
            })();
          },
        });
        button.current.replaceChildren();
        window.google!.accounts.id.renderButton(button.current, {
          theme: "outline",
          size: "large",
        });
      } catch (error) {
        if (active) setMessage((error as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const list = async (more = false) => {
    const result = await api(
      `action=list${more ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      token,
    );
    setFiles((existing) => (more ? [...existing, ...(result.files ?? [])] : (result.files ?? [])));
    setPageToken(result.nextPageToken ?? "");
  };
  const upload = async (kind: "backup" | "transfer") => {
    setReceipt(null);
    const contents =
      kind === "backup" ? await exportBackup() : await createTransferPackage(selectedIds);
    const uploaded = await api("action=upload", token, {
      method: "POST",
      body: JSON.stringify({ kind, contents }),
    });
    setReceipt({
      name: uploaded.name,
      url: uploaded.webViewLink?.startsWith("https://drive.google.com/")
        ? uploaded.webViewLink
        : undefined,
    });
    setMessage(
      kind === "backup"
        ? "Encrypted backup saved to Drive."
        : "Patient transfer saved to Drive. Open it on another device using an approved Google account.",
    );
    try {
      await list();
    } catch {
      setMessage(
        "File saved to Drive, but the file list could not refresh. Check the uploaded file link before retrying.",
      );
    }
  };
  const connect = () => {
    const oauth = window.google?.accounts.oauth2;
    if (!oauth) {
      setMessage("Google authorization did not load. Reload this page and try again.");
      return;
    }
    oauth
      .initCodeClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/drive",
        ux_mode: "popup",
        hint: staff?.ownerEmail ?? "wadhdw25.hkl@moh.gov.my",
        callback: ({ code, error }) => {
          if (error || !code) {
            setMessage("Owner authorization was not completed. No connection was changed.");
            return;
          }
          void run(async () => {
            await api("action=connect-owner", token, {
              method: "POST",
              headers: { "X-HDW-Owner-Connect": "1" },
              body: JSON.stringify({ code }),
            });
            setStaff(await api("action=session", token));
            await list();
            setMessage(
              "Folder owner connected. You can now transfer records to the existing Drive folder.",
            );
          });
        },
        error_callback: () =>
          setMessage("Google authorization was closed or blocked. Allow the popup and try again."),
      })
      .requestCode();
  };
  const unavailable = !!staff?.ownerMode && !staff.ownerConnected;
  const open = async (file: DriveFile) => {
    const result = await api(`action=download&id=${encodeURIComponent(file.id)}`, token);
    if (result.kind === "backup") {
      onBackup(result.contents);
      setMessage(
        "Backup loaded below. Enter an account and passphrase from that backup to preview it before restoring.",
      );
    } else {
      let contents = result.contents;
      if (JSON.parse(contents).app === "HDW CONNECT encrypted transfer") {
        const legacyPassphrase = window.prompt(
          "This older transfer was encrypted with a passphrase. Enter its original passphrase to open it.",
        );
        if (legacyPassphrase === null) return;
        contents = await decryptTransfer(contents, legacyPassphrase);
      }
      await onTransfer(contents);
      setMessage(
        "Transfer loaded. Review its patient records and conflicts below before confirming import.",
      );
    }
  };

  return (
    <div className="space-y-4 rounded border p-4">
      <div>
        <h3 className="font-semibold text-primary">Google Drive transfer</h3>
        <p className="text-sm text-muted-foreground">
          Sign in with your own Google account. The folder owner must share the destination folder
          directly with your email as an Editor. No transfer passphrase is needed. Internet access
          is required. Transfer files are readable by people with access to the Drive folder; keep
          the folder restricted.
        </p>
      </div>
      <div ref={button} className={staff ? "hidden" : ""} />
      {folderId && (
        <p className="text-sm">
          Upload destination:{" "}
          <a
            className="underline"
            href={`https://drive.google.com/drive/folders/${folderId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open configured Google Drive folder
          </a>
        </p>
      )}
      {!staff && (
        <p className="text-sm">
          Sign in with your own Google account to enable transfer and receive.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          className="btn"
          disabled={!staff || unavailable || busy || !selectedIds.length}
          onClick={() => void run(() => upload("transfer"))}
        >
          Confirm transfer to Google Drive ({selectedIds.length})
        </button>
        <button
          className="btn btn-outline"
          disabled={!staff || unavailable || busy}
          onClick={() => void run(() => list())}
        >
          Receive from Google Drive
        </button>
      </div>
      {staff?.ownerMode && staff.administrator && (
        <div className="space-y-2 rounded border p-3 text-sm">
          <p>
            {staff.ownerConnected
              ? `Connected through folder owner: ${staff.ownerEmail}`
              : `One-time setup for all devices: authorize ${staff.ownerEmail}`}
          </p>
          {staff.administrator ? (
            <>
              {!staff.ownerSetupReady && (
                <p>
                  Add GOOGLE_CLIENT_SECRET to Netlify and redeploy to enable owner authorization.
                </p>
              )}
              <button
                className="btn btn-outline"
                disabled={busy || !staff.ownerSetupReady}
                onClick={connect}
              >
                {staff.ownerConnected ? "Reconnect folder owner" : "Connect folder owner"}
              </button>
              <p>
                Administrator setup only. The owner authorizes the backend once for all devices.
                Staff then sign in with their own Google accounts. Reconnect only if Google access
                expires or is revoked.
              </p>
            </>
          ) : (
            !staff.ownerConnected && <p>Ask an administrator to connect the folder owner.</p>
          )}
        </div>
      )}
      {receipt && (
        <p role="status" className="rounded border p-3 text-sm">
          Uploaded: {receipt.name}
          {receipt.url && (
            <>
              {" "}
              ·{" "}
              <a className="underline" href={receipt.url} target="_blank" rel="noopener noreferrer">
                Open uploaded file in Google Drive
              </a>
            </>
          )}
        </p>
      )}
      {staff && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              {staff.email} · {staff.administrator ? "Administrator" : "Staff"}
            </p>
            <button
              className="btn btn-outline"
              disabled={busy}
              onClick={() => {
                identity.current++;
                setToken("");
                setStaff(null);
                setFiles([]);
                setPageToken("");
                setMessage("");
                setReceipt(null);
                window.google?.accounts.id.disableAutoSelect();
              }}
            >
              Sign out of Drive
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            {staff.administrator && (
              <button
                className="btn btn-outline"
                disabled={busy || unavailable}
                onClick={() => void run(() => upload("backup"))}
              >
                Back up vault to Drive
              </button>
            )}
            <button
              className="btn btn-outline"
              disabled={busy || unavailable}
              onClick={() => void run(() => list())}
            >
              Refresh files
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Full vault backups remain encrypted and are available to administrators. Maximum file
            size: 3.5 MB.
          </p>
          <ul className="max-h-72 space-y-2 overflow-auto">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
              >
                <span className="break-all">
                  {file.name}
                  <br />
                  <span className="text-xs text-muted-foreground">
                    {new Date(file.createdTime).toLocaleString()}
                  </span>
                </span>
                <button
                  className="btn btn-outline"
                  disabled={busy}
                  onClick={() => void run(() => open(file))}
                >
                  {file.appProperties.kind === "backup"
                    ? "Load backup for preview"
                    : "Receive on this device"}
                </button>
              </li>
            ))}
          </ul>
          {!files.length && !unavailable && (
            <p className="text-sm text-muted-foreground">
              No HDW CONNECT files listed. Use Refresh files to check the folder.
            </p>
          )}
          {pageToken && (
            <button
              className="btn btn-outline"
              disabled={busy}
              onClick={() => void run(() => list(true))}
            >
              Load more files
            </button>
          )}
        </>
      )}
      {busy && (
        <p role="status" className="text-sm">
          Working…
        </p>
      )}
      {message && (
        <p role="status" className="rounded border p-3 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
