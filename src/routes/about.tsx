import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  APP_VERSION,
  addClinicianAccount,
  applyTransfer,
  createTransferPackage,
  exportBackup,
  inspectTransferPackage,
  previewEncryptedBackup,
  removeClinicianAccount,
  restoreEncryptedBackup,
  useDB,
  type DecryptedTransfer,
} from "@/lib/hdw/store";
import type { Patient } from "@/lib/hdw/types";
import { DrivePanel } from "@/components/hdw/DrivePanel";

const transferFolderUrl =
  "https://drive.google.com/drive/folders/1MTX4PTpVHJIXehpO2aWyJztZlxzI_3KI";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About & Backup — HDW CONNECT" },
      {
        name: "description",
        content:
          "Application information, local encrypted vault, manual record transfer and backup.",
      },
      {
        property: "og:description",
        content:
          "Application information, local encrypted vault, manual record transfer and backup.",
      },
    ],
  }),
  component: About,
});

function About() {
  const { patients, storageError, currentUser, accounts } = useDB();
  const [msg, setMsg] = useState("");
  const [backupText, setBackupText] = useState("");
  const [backupUser, setBackupUser] = useState(currentUser?.name ?? "");
  const [backupPassword, setBackupPassword] = useState("");
  const [backupPreview, setBackupPreview] = useState<{
    patients: Patient[];
    exportedAt: string;
    schema: number;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [transferMethod, setTransferMethod] = useState<"drive" | "manual">("drive");
  const [transferText, setTransferText] = useState("");
  const [transferFromDrive, setTransferFromDrive] = useState(false);
  const [transferPreview, setTransferPreview] = useState<DecryptedTransfer | null>(null);
  const incomingFile = useRef<HTMLInputElement>(null);
  const receivePanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transferPreview)
      receivePanel.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [transferPreview]);
  const [decisions, setDecisions] = useState<Record<string, "keep-local" | "use-transfer">>({});
  const [newClinician, setNewClinician] = useState("");
  const [newClinicianPassword, setNewClinicianPassword] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [recoveryForRemoval, setRecoveryForRemoval] = useState("");
  const [rotatedRecoveryKey, setRotatedRecoveryKey] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    setIsInstalled(
      window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in navigator &&
          Boolean((navigator as Navigator & { standalone?: boolean }).standalone)),
    );
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    });
    return () => window.removeEventListener("beforeinstallprompt", capturePrompt);
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const downloadFile = (contents: string, filename: string, type = "application/octet-stream") => {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const download = async () => {
    try {
      const contents = await exportBackup();
      downloadFile(
        contents,
        `hdw-connect-encrypted-backup-${new Date().toISOString().slice(0, 16).replace(":", "")}.hdwbackup`,
        "application/vnd.hdw-connect.vault+json",
      );
      setMsg("Encrypted backup downloaded. Store it separately from this device.");
    } catch (error) {
      setMsg((error as Error).message);
    }
  };

  const previewBackup = async () => {
    try {
      setBackupPreview(await previewEncryptedBackup(backupText, backupUser, backupPassword));
      setMsg("");
    } catch (error) {
      setBackupPreview(null);
      setMsg(`Backup preview failed: ${(error as Error).message}`);
    }
  };

  const restore = async () => {
    if (
      !backupPreview ||
      !confirm(
        `This encrypted backup contains ${backupPreview.patients.length} record(s), last updated ${new Date(backupPreview.exportedAt).toLocaleString()}. Restoring will replace all ${patients.length} current record(s) on this device. Continue?`,
      )
    )
      return;
    try {
      const count = await restoreEncryptedBackup(backupText, backupUser, backupPassword);
      setMsg(`Restored ${count} encrypted record(s).`);
      setBackupText("");
      setBackupPassword("");
      setBackupPreview(null);
    } catch (error) {
      setMsg(`Restore failed: ${(error as Error).message}. Current records were not changed.`);
    }
  };

  const sendTransfer = async () => {
    try {
      if (!selectedIds.length) throw new Error("Choose at least one patient record.");
      if (
        !confirm(
          "This transfer file is not encrypted. Anyone who obtains a copy can read its patient details. Create the file?",
        )
      )
        return;
      const contents = await createTransferPackage(selectedIds);
      downloadFile(
        contents,
        `hdw-connect-transfer-${new Date().toISOString().slice(0, 16).replace(":", "")}.hdwtransfer`,
        "application/vnd.hdw-connect.transfer+json",
      );
      setMsg(
        "Transfer file downloaded. It is readable by anyone who obtains it; send and store it only through an approved method.",
      );
    } catch (error) {
      setMsg((error as Error).message);
    }
  };

  const previewTransfer = async () => {
    try {
      setTransferPreview(await inspectTransferPackage(transferText));
      setDecisions({});
      setMsg("");
    } catch (error) {
      setTransferPreview(null);
      setMsg(`Transfer could not be opened: ${(error as Error).message}`);
    }
  };

  const receiveTransfer = async () => {
    if (!transferPreview) return;
    if (
      !confirm(
        `Import ${transferPreview.records.length} record(s) into this device? Conflicts will follow your choices below.`,
      )
    )
      return;
    try {
      const result = await applyTransfer(transferPreview, decisions);
      setMsg(
        `Transfer applied: ${result.added} added, ${result.replaced} replaced. Records already on this device were preserved where selected.`,
      );
      setTransferText("");
      setTransferPreview(null);
      setDecisions({});
    } catch (error) {
      setMsg(`Import failed: ${(error as Error).message}`);
    }
  };

  const addUser = async () => {
    try {
      await addClinicianAccount(newClinician, newClinicianPassword);
      setMsg(
        `Added ${newClinician} on this device. Share the updated encrypted vault with the clinician's other authorized devices.`,
      );
      setNewClinician("");
      setNewClinicianPassword("");
    } catch (error) {
      setMsg((error as Error).message);
    }
  };

  const removeUser = async () => {
    try {
      const code = await removeClinicianAccount(removeId, recoveryForRemoval);
      setRotatedRecoveryKey(code);
      setRecoveryForRemoval("");
      setRemoveId("");
      setMsg(
        "Clinician access was removed from this device's vault and the vault encryption key was rotated. Other devices must receive the updated vault; previously copied records cannot be remotely erased.",
      );
    } catch (error) {
      setMsg((error as Error).message);
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <section className="panel p-6">
        <h1 className="text-2xl font-bold text-primary">HDW CONNECT</h1>
        <p className="font-serif italic">One Patient. One Clinical Record. Connected Care.</p>
        <p className="mt-3 text-sm">
          Digital transformation of clinical referral, transfer and discharge documentation — High
          Dependency Ward, Acute Internal Medicine, Medical Department, Hospital Kuala Lumpur.
        </p>
        <p className="mt-2 text-sm">
          Clinical project lead: Dr Khairul Azlan bin Abdul Aziz, Acute Internal Medicine Specialist
          UD15.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="label-caps">Version</dt>
          <dd>{APP_VERSION}</dd>
          <dt className="label-caps">Status</dt>
          <dd>Encrypted browser prototype</dd>
          <dt className="label-caps">Storage</dt>
          <dd>Encrypted in this browser profile</dd>
          <dt className="label-caps">Signed in as</dt>
          <dd>
            {currentUser?.name} · {currentUser?.role}
          </dd>
          <dt className="label-caps">Records</dt>
          <dd>{patients.length}</dd>
        </dl>
        <p className="mt-4 rounded-sm border-l-4 border-accent bg-secondary p-3 text-xs">
          This browser prototype encrypts records in browser storage and vault backups. Google Drive
          and manual transfer files are readable JSON; Drive access is limited to approved accounts.
          Browser storage is not equivalent to native app-private storage protected by the device
          key store. Use synthetic or de-identified data unless an approved clinical environment is
          in use.
        </p>
      </section>

      <section className="panel space-y-3 p-6">
        <div>
          <h2 className="text-lg font-semibold text-primary">Install for offline use</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Install HDW CONNECT on this device. Open it once while connected so the app files are
            saved for offline use. Patient records remain in this device’s browser storage and do
            not sync to other devices.
          </p>
        </div>
        {isInstalled ? (
          <p className="text-sm font-medium text-success">
            HDW CONNECT is installed on this device.
          </p>
        ) : installPrompt ? (
          <button className="btn w-fit" onClick={() => void installApp()}>
            Install HDW CONNECT
          </button>
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              <strong>Android:</strong> In Chrome, open the browser menu and choose{" "}
              <strong>Install app</strong> or <strong>Add to Home screen</strong>.
            </p>
            <p>
              <strong>iPhone/iPad:</strong> Open this page in Safari, tap <strong>Share</strong>,
              then <strong>Add to Home Screen</strong>.
            </p>
            <p className="text-xs text-muted-foreground">
              This page must first be opened from a secure web address while online. After
              installation and the first load, the app shell can open offline. Browser storage can
              still be cleared by device settings.
            </p>
          </div>
        )}
      </section>

      <section className="panel space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold text-primary">Encrypted local backup</h2>
          <p className="text-sm text-muted-foreground">
            The backup contains ciphertext. Restore requires a clinician account and passphrase in
            the backup. The vault recovery key is also embedded as an encrypted recovery wrapper;
            keep this file separately protected.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="btn" disabled={!!storageError} onClick={() => void download()}>
            Download encrypted backup
          </button>
          <label className="btn btn-outline cursor-pointer">
            Select encrypted backup
            <input
              type="file"
              accept=".hdwbackup,application/json"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) {
                  setBackupText(await file.text());
                  setBackupPreview(null);
                }
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        {backupText && (
          <div className="space-y-3 rounded-sm border p-4">
            <h3 className="font-semibold">Preview backup before restore</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="label-caps">Account in backup</span>
                <input
                  className="field mt-1"
                  value={backupUser}
                  onChange={(event) => setBackupUser(event.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="label-caps">Backup passphrase</span>
                <input
                  className="field mt-1"
                  type="password"
                  value={backupPassword}
                  onChange={(event) => setBackupPassword(event.target.value)}
                />
              </label>
            </div>
            <button className="btn btn-outline" onClick={() => void previewBackup()}>
              Decrypt and preview
            </button>
            {backupPreview && (
              <div className="space-y-2">
                <p className="text-sm">
                  {backupPreview.patients.length} patient record(s) · last saved{" "}
                  {new Date(backupPreview.exportedAt).toLocaleString()}
                </p>
                <ul className="max-h-36 overflow-auto rounded border p-2 text-sm">
                  {backupPreview.patients.map((patient) => (
                    <li key={patient.id}>
                      {patient.name || "Unnamed patient"} · {patient.mrn || "No MRN"}
                    </li>
                  ))}
                </ul>
                <button className="btn" onClick={() => void restore()}>
                  Replace this device's records
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="panel space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold text-primary">Record transfer</h2>
          <p className="text-sm text-muted-foreground">
            Choose Google Drive to upload and retrieve records, or Manual transfer to download and
            select a .hdwtransfer file. Neither method needs a transfer passphrase. Review records
            before importing. Full vault backups remain encrypted.
          </p>
        </div>
        <fieldset className="space-y-2">
          <legend className="label-caps">Transfer method</legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="transfer-method"
                checked={transferMethod === "drive"}
                onChange={() => setTransferMethod("drive")}
              />
              Google Drive
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="transfer-method"
                checked={transferMethod === "manual"}
                onChange={() => setTransferMethod("manual")}
              />
              Manual transfer
            </label>
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="label-caps">Records to send</legend>
          <div className="max-h-56 space-y-1 overflow-auto rounded border p-3">
            {patients.map((patient) => (
              <label key={patient.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(patient.id)}
                  onChange={() =>
                    setSelectedIds((ids) =>
                      ids.includes(patient.id)
                        ? ids.filter((id) => id !== patient.id)
                        : [...ids, patient.id],
                    )
                  }
                />
                <span>
                  {patient.name || "Unnamed patient"} · {patient.mrn || "No MRN"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {transferMethod === "drive" && (
          <DrivePanel
            selectedIds={selectedIds}
            onBackup={(contents) => {
              setBackupText(contents);
              setBackupPreview(null);
              setBackupPassword("");
            }}
            onTransfer={async (contents) => {
              const preview = await inspectTransferPackage(contents);
              setTransferText(contents);
              setTransferFromDrive(true);
              setTransferPreview(preview);
              setDecisions({});
            }}
          />
        )}
        {transferMethod === "manual" && (
          <div className="space-y-3">
            <p className="text-sm">
              Download the selected records, then open the upload destination and upload the
              .hdwtransfer file in Google Drive.
            </p>
            <p className="text-sm">
              Upload destination:{" "}
              <a
                className="underline"
                href={transferFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open configured Google Drive folder
              </a>
            </p>
            <button
              className="btn"
              disabled={!selectedIds.length}
              onClick={() => void sendTransfer()}
            >
              Confirm transfer and download
            </button>
          </div>
        )}
        <div ref={receivePanel} className="space-y-3 rounded border p-4">
          <h3 className="font-semibold">Receive on this device</h3>
          <p className="text-sm">
            To receive a file manually, open the Google Drive folder, select the .hdwtransfer file
            and download it. Then choose Receive from file below and select the downloaded file to
            review before importing.
          </p>
          <a
            className="btn btn-outline"
            href={transferFolderUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Google Drive folder to receive
          </a>
          <p className="text-sm text-muted-foreground">
            The folder owner must share the folder directly with your Google email as an Editor.
            Sign in to Google Drive with that account; Google controls access to the folder. Manual
            upload and download do not need the owner to sign in on your device. Selecting a file
            here opens a file already saved on this device.
          </p>
          <button className="btn btn-outline" onClick={() => incomingFile.current?.click()}>
            Receive from file
          </button>
          <input
            ref={incomingFile}
            aria-label="Incoming transfer file"
            type="file"
            accept=".hdwtransfer,application/json"
            className="hidden"
            onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              input.value = "";
              if (!file) return;
              setTransferText("");
              setTransferPreview(null);
              setDecisions({});
              try {
                const contents = await file.text();
                const preview = await inspectTransferPackage(contents);
                setTransferText(contents);
                setTransferFromDrive(false);
                setTransferPreview(preview);
                setMsg("");
              } catch (error) {
                setMsg(`Transfer could not be opened: ${(error as Error).message}`);
              }
            }}
          />
          {transferText && (
            <div className="space-y-3">
              <p className="text-sm">
                {transferFromDrive
                  ? "These records were retrieved from Drive. Review them before importing."
                  : "This file is readable without a password. Review its contents before importing."}
              </p>
              <button className="btn btn-outline" onClick={() => void previewTransfer()}>
                Read and preview
              </button>
              {transferPreview && (
                <div className="space-y-3">
                  <p className="text-sm">
                    Transfer file · {new Date(transferPreview.createdAt).toLocaleString()}
                  </p>
                  {transferPreview.records.map(({ id, patient, conflict }) => (
                    <div key={id} className="rounded border p-3 text-sm">
                      <p className="font-semibold">
                        {patient.name || "Unnamed patient"} · {patient.mrn || "No MRN"}
                        {conflict ? " · Conflict" : ""}
                      </p>
                      {conflict ? (
                        <fieldset className="mt-2 flex flex-wrap gap-4">
                          <legend className="label-caps">Choose the version to keep</legend>
                          <label className="flex items-center gap-1">
                            <input
                              type="radio"
                              name={`conflict-${id}`}
                              checked={decisions[id] === "keep-local"}
                              onChange={() =>
                                setDecisions((value) => ({ ...value, [id]: "keep-local" }))
                              }
                            />
                            Keep this device
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="radio"
                              name={`conflict-${id}`}
                              checked={decisions[id] === "use-transfer"}
                              onChange={() =>
                                setDecisions((value) => ({ ...value, [id]: "use-transfer" }))
                              }
                            />
                            Use transferred version
                          </label>
                        </fieldset>
                      ) : (
                        <p className="text-muted-foreground">Will be added as a new record.</p>
                      )}
                    </div>
                  ))}
                  <button
                    className="btn"
                    disabled={transferPreview.records.some(
                      (item) => item.conflict && !decisions[item.id],
                    )}
                    onClick={() => void receiveTransfer()}
                  >
                    Confirm and import
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="panel space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold text-primary">Clinician accounts on this device</h2>
          <p className="text-sm text-muted-foreground">
            Each account has a distinct RSA key pair; patient data keys are encrypted to account
            public keys. Removing an account rotates this device's vault key, but cannot remotely
            erase copies already transferred to other devices.
          </p>
        </div>
        <ul className="space-y-1 text-sm">
          {accounts.map((account) => (
            <li key={account.id}>
              {account.name} · {account.role}
              {account.id === currentUser?.id ? " · signed in" : ""}
            </li>
          ))}
        </ul>
        {currentUser?.role === "administrator" && (
          <div className="grid gap-3 rounded border p-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="label-caps">New clinician</span>
              <input
                className="field mt-1"
                value={newClinician}
                onChange={(event) => setNewClinician(event.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="label-caps">Temporary passphrase for setup</span>
              <input
                className="field mt-1"
                type="password"
                minLength={12}
                value={newClinicianPassword}
                onChange={(event) => setNewClinicianPassword(event.target.value)}
              />
            </label>
            <button
              className="btn w-fit"
              disabled={!newClinician.trim() || newClinicianPassword.length < 12}
              onClick={() => void addUser()}
            >
              Add clinician account
            </button>
          </div>
        )}
        {currentUser?.role === "administrator" &&
          accounts.some((account) => account.role === "clinician") && (
            <div className="space-y-3 rounded border border-destructive/30 p-4">
              <h3 className="font-semibold">Remove clinician from this device's vault</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="label-caps">Account</span>
                  <select
                    className="field mt-1"
                    value={removeId}
                    onChange={(event) => setRemoveId(event.target.value)}
                  >
                    <option value="">Select account</option>
                    {accounts
                      .filter((account) => account.role !== "administrator")
                      .map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="label-caps">Current recovery key (will be rotated)</span>
                  <input
                    className="field mt-1 font-mono"
                    value={recoveryForRemoval}
                    onChange={(event) => setRecoveryForRemoval(event.target.value)}
                  />
                </label>
              </div>
              <button
                className="btn btn-outline"
                disabled={!removeId || !recoveryForRemoval}
                onClick={() => {
                  if (
                    confirm(
                      "Remove this account from the local vault and rotate its encryption key? Other devices must receive the updated vault.",
                    )
                  )
                    void removeUser();
                }}
              >
                Remove account and rotate key
              </button>
            </div>
          )}
        {rotatedRecoveryKey && (
          <div className="space-y-2 rounded border-2 border-destructive p-4">
            <p className="font-semibold">New recovery key — save this separately now</p>
            <p className="break-all font-mono">{rotatedRecoveryKey}</p>
            <button
              className="btn btn-outline"
              onClick={() => void navigator.clipboard?.writeText(rotatedRecoveryKey)}
            >
              Copy recovery key
            </button>
            <button className="ml-2 text-sm underline" onClick={() => setRotatedRecoveryKey("")}>
              I saved it
            </button>
          </div>
        )}
      </section>

      <section className="panel p-6">
        <h2 className="text-lg font-semibold text-primary">Project and data use</h2>
        <p className="mt-2 rounded-sm border-l-4 border-accent bg-secondary p-3 text-xs">
          HDW CONNECT is a local HDW quality-improvement project. It is not officially approved by,
          endorsed by, or integrated with Hospital Kuala Lumpur, the Ministry of Health Malaysia, or
          any EMR. Use synthetic or de-identified data unless an approved clinical environment is in
          use. The clinician remains responsible for every generated document.
        </p>
      </section>
      {msg && (
        <p role="status" className="text-sm font-medium">
          {msg}
        </p>
      )}
      {storageError && (
        <p role="alert" className="text-sm text-destructive">
          {storageError}
        </p>
      )}
    </main>
  );
}
