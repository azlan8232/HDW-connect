import { useState, type FormEvent } from "react";
import { confirmRecoveryKeySaved, createLocalVault, recoverLocalVault, unlockLocalVault, useDB } from "@/lib/hdw/store";

export function VaultGate() {
  const { vaultStatus, legacyDataFound, accounts, storageError } = useDB();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newRecoveryCode, setNewRecoveryCode] = useState("");
  const [mode, setMode] = useState<"login" | "recover">("login");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setWorking(true);
    try {
      if (vaultStatus === "setup") {
        if (password !== confirmPassword) throw new Error("The passphrases do not match.");
        setNewRecoveryCode(await createLocalVault(name, password));
      } else if (mode === "recover") {
        if (password !== confirmPassword) throw new Error("The new passphrases do not match.");
        setNewRecoveryCode(await recoverLocalVault(name, recoveryCode, password));
      } else {
        await unlockLocalVault(name, password);
      }
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      setMessage((error as Error).message || "Unable to unlock the local vault.");
    } finally {
      setWorking(false);
    }
  };

  const recoveryPending = vaultStatus === "recovery-pending" && !!newRecoveryCode;
  if (vaultStatus === "checking") return <main className="mx-auto max-w-lg px-4 py-16"><section className="panel p-6">Opening encrypted local vault…</section></main>;
  if (vaultStatus === "error") return <main className="mx-auto max-w-lg px-4 py-16"><section className="panel space-y-3 p-6"><h1 className="text-2xl font-bold text-primary">Vault unavailable</h1><p role="alert" className="text-sm text-destructive">{storageError}</p><p className="text-sm">The saved data was left untouched. Restore a valid encrypted backup or contact the device administrator.</p></section></main>;

  return (
    <main className="mx-auto max-w-lg px-4 py-10 sm:py-16">
      <section className="panel space-y-5 p-6 sm:p-8">
        <div>
          <p className="label-caps">HDW CONNECT · Local encrypted storage</p>
          <h1 className="mt-1 text-2xl font-bold text-primary">{recoveryPending ? "Save your recovery key" : vaultStatus === "setup" ? "Set up this device" : mode === "recover" ? "Recover this vault" : "Unlock this device"}</h1>
        </div>

        {recoveryPending ? (
          <>
            <p className="text-sm">This recovery key is shown once. Store it separately from this device. It can restore access if the clinician passphrase is forgotten.</p>
            <div className="break-all rounded-sm border bg-secondary p-4 font-mono text-lg font-semibold tracking-wide" aria-label="One-time recovery key">{newRecoveryCode}</div>
            <button className="btn btn-outline" onClick={() => void navigator.clipboard?.writeText(newRecoveryCode)}>Copy recovery key</button>
            <p className="text-sm font-semibold text-destructive">Anyone with this key can recover this vault. Do not store it with the device or in a patient record.</p>
            <button className="btn w-full justify-center" onClick={() => { setNewRecoveryCode(""); confirmRecoveryKeySaved(); }}>I saved the recovery key separately</button>
          </>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            {(vaultStatus === "setup" || mode === "recover") && (
              <label className="block text-sm"><span className="label-caps">Clinician name</span><input className="field mt-1" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} /></label>
            )}
            {vaultStatus === "locked" && mode === "login" && (
              <label className="block text-sm"><span className="label-caps">Clinician account</span><select className="field mt-1" required value={name} onChange={(event) => setName(event.target.value)}><option value="">Select account</option>{accounts.map((account) => <option key={account.id} value={account.name}>{account.name}{account.role === "administrator" ? " · Administrator" : ""}</option>)}</select></label>
            )}
            {mode === "recover" && vaultStatus !== "setup" && <label className="block text-sm"><span className="label-caps">Offline recovery key</span><input className="field mt-1 font-mono" autoComplete="off" required value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} /></label>}
            <label className="block text-sm"><span className="label-caps">{mode === "recover" ? "New passphrase" : "Passphrase"}</span><input className="field mt-1" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {(vaultStatus === "setup" || mode === "recover") && <label className="block text-sm"><span className="label-caps">Confirm passphrase</span><input className="field mt-1" type="password" autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>}
            {vaultStatus === "setup" && <p className="rounded-sm border-l-4 border-accent bg-secondary p-3 text-sm">Use a unique passphrase with at least 12 characters. Password reset cannot decrypt records; the separately stored recovery key is required.</p>}
            {vaultStatus === "setup" && legacyDataFound && <p className="rounded-sm border border-warning p-3 text-sm">Existing browser records were found. They will be encrypted on this device and removed from the old plaintext browser entry only after the encrypted copy is verified.</p>}
            {vaultStatus === "setup" && !legacyDataFound && <p className="text-sm text-muted-foreground">A synthetic sample record will be added to the new encrypted vault.</p>}
            {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
            {storageError && <p role="alert" className="text-sm text-destructive">{storageError}</p>}
            <button className="btn w-full justify-center" disabled={working}>{working ? "Working…" : vaultStatus === "setup" ? "Create encrypted vault" : mode === "recover" ? "Recover and reset passphrase" : "Unlock vault"}</button>
            {vaultStatus === "locked" && <button type="button" className="w-full text-sm underline" onClick={() => { setMode(mode === "recover" ? "login" : "recover"); setMessage(""); }}> {mode === "recover" ? "Back to sign in" : "Forgot passphrase? Use recovery key"}</button>}
          </form>
        )}
        <p className="border-t pt-3 text-xs text-muted-foreground">Records are encrypted on this device. Bluetooth transfer requires a compatible installed app; this browser build does not provide cross-platform Bluetooth.</p>
      </section>
    </main>
  );
}
