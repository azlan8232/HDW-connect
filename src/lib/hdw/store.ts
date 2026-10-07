import { useEffect, useState } from "react";
import { READINESS, REFERRAL_SECTIONS, type DocState, type DocStatus, type Investigation, type Patient, type Readiness, type ReferralRecord } from "./types";
import { addVaultAccount, createVault, parseVaultEnvelope, recoverVault, removeVaultAccount, saveVaultRecords, unlockVault, type UnlockedVault, type VaultAccount, type VaultEnvelope } from "./vault-crypto";
import { createTransferFile, parseTransferFile } from "./transfer-file";

export const APP_VERSION = "0.8.0";
const KEY = "hdw-connect.db";
const SCHEMA = 6;
const VAULT_KEY = "hdw-connect.encrypted-vault";

interface DB { schema: number; patients: Patient[] }
export type VaultStatus = "checking" | "setup" | "locked" | "recovery-pending" | "unlocked" | "error";

let db: DB = { schema: SCHEMA, patients: [] };
let loaded = false;
let storageError: string | null = null;
let vaultStatus: VaultStatus = "checking";
let vaultEnvelope: VaultEnvelope | null = null;
let unlockedVault: UnlockedVault | null = null;
let currentUser: VaultAccount | null = null;
let legacyDataFound = false;
let persistQueue: Promise<void> = Promise.resolve();
const subs = new Set<() => void>();

function notify() { subs.forEach((subscriber) => subscriber()); }

function validateDB(input: unknown): DB {
  if (!isRecord(input) || !Number.isInteger(input.schema) || Number(input.schema) < 1 || Number(input.schema) > SCHEMA || !Array.isArray(input.patients)) {
    throw new Error("Saved data has an unsupported or invalid format.");
  }
  const patients = input.patients.map(migratePatient);
  if (new Set(patients.map((patient) => patient.id)).size !== patients.length) throw new Error("Saved data contains duplicate patient IDs.");
  return { schema: SCHEMA, patients };
}

function readLegacyDB(): DB {
  const raw = localStorage.getItem(KEY);
  if (!raw) return { schema: SCHEMA, patients: [demoPatient()] };
  return validateDB(JSON.parse(raw) as unknown);
}

function bootstrapVault() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const stored = localStorage.getItem(VAULT_KEY);
    if (stored) {
      vaultEnvelope = parseVaultEnvelope(stored);
      if (vaultEnvelope.schema > SCHEMA) throw new Error("This encrypted vault was created by a newer app version.");
      vaultStatus = "locked";
    } else {
      legacyDataFound = localStorage.getItem(KEY) !== null;
      vaultStatus = "setup";
    }
  } catch (error) {
    storageError = (error as Error).message || "The saved encrypted vault could not be read.";
    vaultStatus = "error";
  }
  notify();
}

export const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

export function blankPatient(): Patient {
  return {
    id: uid(), name: "", mrn: "", ic: "", age: "", sex: "", bed: "",
    admissionDate: "", hdwAdmissionDate: "", source: "", team: "", consultant: "",
    allergies: "",
    presentingProblem: "", hdwReason: "", primaryDx: "", comorbidities: "",
    events: "", progress: "", currentCondition: { bloodPressure: "", heartRate: "", respiratoryRate: "", spo2: "", oxygenModality: "", avpu: "", other: "" },
    interventions: [], devices: "",
    problems: [], pending: [], meds: [], investigations: [],
    referrals: [],
    transfer: { destination: "", datetime: "", oxygen: "", monitoring: "", nursing: "", mobility: "", nutrition: "", isolation: "", escalation: "", responsible: "", handover: "", readiness: "Not Ready", blockers: [] },
    discharge: { date: "", condition: "", followUp: "", repeatInv: "", woundCare: "", rehab: "", mc: "", patientSummary: "", instructions: "", warnings: "", readiness: "Not Ready", blockers: [] },
    docs: {}, createdAt: now(), updatedAt: now(),
  };
}

export function blankReferral(): ReferralRecord {
  return { id: uid(), service: "", urgency: "", reason: "", question: "", findings: "", investigationIds: [], treatmentTried: "", request: "", clinician: "", contact: "", outcome: "", include: ["diagnoses", "history", "currentCondition", "findings", "investigations", "medications", "devices", "treatment"] };
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isReadiness = (x: unknown): x is Readiness => typeof x === "string" && (READINESS as readonly string[]).includes(x);
const hasTextFields = (obj: Record<string, unknown>, fields: string[], label: string) => {
  for (const field of fields) if (obj[field] !== undefined && typeof obj[field] !== "string") throw new Error(`${label} has an invalid ${field}`);
};
function validateDocState(value: unknown, label: string, depth = 0): void {
  if (depth > 20) throw new Error(`${label} has nested version data that is too deep`);
  const statuses: DocStatus[] = ["Draft", "Reviewed", "Verified", "Final"];
  if (!isRecord(value) || !statuses.includes(value.status as DocStatus) || !Number.isInteger(value.version) || typeof value.author !== "string" || !isRecord(value.checks)) throw new Error(`${label} is invalid`);
  if (Object.values(value.checks).some((checked) => typeof checked !== "boolean")) throw new Error(`${label} has invalid checklist data`);
  if (value.status === "Final" && (!isRecord(value.snapshot) || typeof value.snapshot.id !== "string")) throw new Error(`${label} is missing its final snapshot`);
  if (value.history !== undefined) {
    if (!Array.isArray(value.history)) throw new Error(`${label} has invalid version history`);
    for (const version of value.history) validateDocState(version, `${label} history`, depth + 1);
  }
}

function migrateDocState(value: unknown, label: string, depth: number): DocState {
  if (depth > 20) throw new Error(`${label} has nested snapshots that are too deep`);
  validateDocState(value, label);
  if (!isRecord(value)) throw new Error(`${label} is invalid`);
  const snapshot = isRecord(value.snapshot) ? migratePatient(value.snapshot, depth + 1) : undefined;
  const history = Array.isArray(value.history) ? value.history.map((version) => migrateDocState(version, `${label} history`, depth + 1)) : undefined;
  return { ...value, ...(snapshot ? { snapshot } : {}), ...(history ? { history } : {}) } as DocState;
}

// Schema 1 stored readiness once per patient and one shared referral document state.
function migratePatient(value: unknown, depth = 0): Patient {
  if (depth > 20) throw new Error("Backup contains nested document snapshots that are too deep");
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) throw new Error("A patient record is missing its ID");
  hasTextFields(value, ["name", "mrn", "ic", "age", "sex", "bed", "admissionDate", "hdwAdmissionDate", "source", "team", "consultant", "allergies", "presentingProblem", "hdwReason", "primaryDx", "secondaryDx", "comorbidities", "events", "procedures", "organSupport", "progress", "devices", "createdAt", "updatedAt"], `Patient ${value.id}`);
  if (value.currentCondition !== undefined && typeof value.currentCondition !== "string" && !isRecord(value.currentCondition)) throw new Error(`Patient ${value.id} has invalid current condition data`);
  if (isRecord(value.currentCondition)) {
    hasTextFields(value.currentCondition, ["bloodPressure", "heartRate", "respiratoryRate", "spo2", "oxygenModality", "avpu", "other"], "Current condition data");
    if (value.currentCondition.avpu !== undefined && !["", "Alert", "Reacts to voice", "Reacts to pain", "Unresponsive"].includes(String(value.currentCondition.avpu))) throw new Error(`Patient ${value.id} has an invalid AVPU value`);
  }
  for (const key of ["problems", "pending", "meds"] as const) {
    if (value[key] !== undefined && !Array.isArray(value[key])) throw new Error(`Patient ${value.id} has an invalid ${key} list`);
  }
  const validateList = (key: "problems" | "pending" | "meds", fields: string[]) => {
    for (const item of (value[key] as unknown[] | undefined) ?? []) {
      if (!isRecord(item) || typeof item.id !== "string") throw new Error(`Patient ${value.id} has an invalid ${key} item`);
      hasTextFields(item, fields, `${key} item`);
      if (key === "pending" && item.done !== undefined && typeof item.done !== "boolean") throw new Error("Pending task has invalid completion state");
      if (key === "meds" && item.status !== undefined && !["Continue", "Stop", "Changed", "New", "Temporary"].includes(String(item.status))) throw new Error("Medication has invalid status");
    }
  };
  validateList("problems", ["problem", "status", "treatment", "next"]);
  validateList("pending", ["task", "status", "action", "responsible", "timing"]);
  validateList("meds", ["name", "dose", "route", "freq", "note"]);
  if (value.investigations !== undefined && (!Array.isArray(value.investigations) || value.investigations.some((x) => !isRecord(x) || typeof x.id !== "string" || typeof x.date !== "string" || typeof x.details !== "string"))) throw new Error(`Patient ${value.id} has an invalid investigations list`);
  for (const key of ["interventions", "blockers"] as const) if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some((x) => typeof x !== "string"))) throw new Error(`Patient ${value.id} has an invalid ${key} list`);
  if (value.referrals !== undefined && !Array.isArray(value.referrals)) throw new Error(`Patient ${value.id} has an invalid referral list`);
  if (value.transfer !== undefined && !isRecord(value.transfer)) throw new Error(`Patient ${value.id} has invalid transfer data`);
  if (value.discharge !== undefined && !isRecord(value.discharge)) throw new Error(`Patient ${value.id} has invalid discharge data`);
  if (value.docs !== undefined && !isRecord(value.docs)) throw new Error(`Patient ${value.id} has invalid document states`);
  if (isRecord(value.docs)) {
    for (const key of ["referral", "transfer", "discharge"] as const) if (value.docs[key] !== undefined) validateDocState(value.docs[key], `${key} document`);
    if (value.docs.referrals !== undefined) {
      if (!isRecord(value.docs.referrals)) throw new Error(`Patient ${value.id} has invalid referral document states`);
      for (const doc of Object.values(value.docs.referrals)) validateDocState(doc, "Referral document");
    }
  }
  if (isRecord(value.transfer)) hasTextFields(value.transfer, ["destination", "receivingTeam", "datetime", "oxygen", "monitoring", "nursing", "mobility", "nutrition", "isolation", "escalation", "responsible", "handover"], "Transfer data");
  if (isRecord(value.discharge)) hasTextFields(value.discharge, ["date", "condition", "followUp", "repeatInv", "woundCare", "rehab", "mc", "patientSummary", "instructions", "warnings"], "Discharge data");
  const blank = blankPatient();
  const oldReadiness = isReadiness(value.readiness) ? value.readiness : "Not Ready";
  const oldBlockers = Array.isArray(value.blockers) ? value.blockers.filter((x): x is string => typeof x === "string") : [];
  const oldTransfer = isRecord(value.transfer) ? value.transfer : {};
  const oldDischarge = isRecord(value.discharge) ? value.discharge : {};
  const oldCondition = typeof value.currentCondition === "string" ? value.currentCondition : "";
  const conditionRecord = isRecord(value.currentCondition) ? value.currentCondition : {};
  const oldEvents = typeof value.events === "string" ? value.events.split(/\r?\n/).filter((line) => !line.startsWith("Previously recorded organ support: ")).join("\n").trim() : "";
  const events = oldEvents;
  const referralItems = Array.isArray(value.referrals) ? value.referrals : isRecord(value.referral) ? [value.referral] : [];
  const referrals = referralItems
      .map((x: unknown) => {
        if (!isRecord(x) || typeof x.id !== "string") throw new Error(`Patient ${value.id} has an invalid referral`);
        hasTextFields(x, ["service", "urgency", "reason", "question", "findings", "investigations", "legacyInvestigations", "treatmentTried", "request", "clinician", "contact", "outcome"], "Referral data");
        const base = blankReferral();
        const include = Array.isArray(x.include) ? x.include.filter((s): s is (typeof REFERRAL_SECTIONS)[number] => typeof s === "string" && (REFERRAL_SECTIONS as readonly string[]).includes(s)) : base.include;
        if (x.investigationIds !== undefined && (!Array.isArray(x.investigationIds) || x.investigationIds.some((id) => typeof id !== "string"))) throw new Error("Referral has invalid investigation selections");
        const migrated = { ...base, ...x, legacyInvestigations: typeof x.investigations === "string" ? x.investigations : typeof x.legacyInvestigations === "string" ? x.legacyInvestigations : "", investigationIds: Array.isArray(x.investigationIds) ? x.investigationIds : [], include } as ReferralRecord & { investigations?: unknown };
        delete migrated.investigations;
        return migrated;
      });
  if (new Set(referrals.map((referral) => referral.id)).size !== referrals.length) throw new Error(`Patient ${value.id} has duplicate referral IDs`);
  const legacyDocs = isRecord(value.docs) ? { ...value.docs } : {};
  const referralStates = isRecord(legacyDocs.referrals) ? { ...legacyDocs.referrals } : {};
  const legacySingleReferral = isRecord(value.referral) && !Array.isArray(value.referrals);
  if (legacyDocs.referral && referrals.length === 1 && !legacySingleReferral && !referralStates[referrals[0].id]) {
    referralStates[referrals[0].id] = legacyDocs.referral;
  }
  for (const key of ["referral", "transfer", "discharge"] as const) {
    if (legacyDocs[key] !== undefined) legacyDocs[key] = migrateDocState(legacyDocs[key], `${key} document`, depth);
  }
  for (const key of Object.keys(referralStates)) referralStates[key] = migrateDocState(referralStates[key], "Referral document", depth);
  const investigations = Array.isArray(value.investigations) ? [...value.investigations as Investigation[]] : [];
  for (const referral of referrals) {
    if (referral.legacyInvestigations?.trim() && !referral.investigationIds.length) {
      const investigation = { id: uid(), date: "", details: referral.legacyInvestigations.trim() };
      investigations.push(investigation);
      referral.investigationIds = [investigation.id];
    }
  }
  const legacySecondary = typeof value.secondaryDx === "string" ? value.secondaryDx : "";
  const problems = Array.isArray(value.problems) ? [...value.problems] as Patient["problems"] : [];
  for (const diagnosis of legacySecondary.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    if (!problems.some((problem) => problem.problem.trim().toLocaleLowerCase() === diagnosis.toLocaleLowerCase())) {
      problems.push({ id: uid(), problem: diagnosis, status: "Review carried-forward diagnosis", treatment: "", next: "" });
    }
  }
  const oldDevices = typeof value.devices === "string" ? value.devices.trim() : "";
  const oldProcedures = typeof value.procedures === "string" ? value.procedures.trim() : "";
  const migrated = {
    ...blank,
    ...value,
    referrals,
    investigations,
    problems,
    events,
    currentCondition: {
      ...blank.currentCondition,
      ...conditionRecord,
      other: typeof conditionRecord.other === "string" && conditionRecord.other ? conditionRecord.other : oldCondition,
    },
    devices: [oldDevices, oldProcedures].filter(Boolean).join("\n"),
    transfer: {
      ...blank.transfer, ...oldTransfer,
      readiness: isReadiness(oldTransfer.readiness) ? oldTransfer.readiness : oldReadiness,
      blockers: Array.isArray(oldTransfer.blockers) ? oldTransfer.blockers.filter((x): x is string => typeof x === "string") : oldBlockers,
    },
    discharge: {
      ...blank.discharge, ...oldDischarge,
      readiness: isReadiness(oldDischarge.readiness) ? oldDischarge.readiness : oldReadiness,
      blockers: Array.isArray(oldDischarge.blockers) ? oldDischarge.blockers.filter((x): x is string => typeof x === "string") : oldBlockers,
    },
    docs: { ...legacyDocs, referrals: referralStates } as Patient["docs"],
  } as Patient;
  const legacy = migrated as Patient & { readiness?: unknown; blockers?: unknown };
  delete legacy.readiness;
  delete legacy.blockers;
  delete (migrated as Patient & { referral?: unknown }).referral;
  delete (migrated as Patient & { secondaryDx?: unknown }).secondaryDx;
  delete (migrated as Patient & { procedures?: unknown }).procedures;
  delete (migrated as Patient & { organSupport?: unknown }).organSupport;
  return migrated;
}

function demoPatient(): Patient {
  const p = blankPatient();
  return {
    ...p,
    name: "DEMO PATIENT A (synthetic)", mrn: "TEST-000123", ic: "XXXXXX-XX-0001", age: "58", sex: "Male", bed: "HDW Bed 4",
    admissionDate: "2026-09-28", hdwAdmissionDate: "2026-09-29", source: "Emergency Department", team: "Acute Internal Medicine", consultant: "AIM Consultant on call",
    allergies: "Penicillin — rash",
    presentingProblem: "Fever, breathlessness and reduced urine output for 3 days.",
    hdwReason: "Severe community-acquired pneumonia with type 1 respiratory failure and AKI.",
    primaryDx: "Severe community-acquired pneumonia (right lower lobe)",
    comorbidities: "Type 2 diabetes mellitus, hypertension",
    events: "Required HFNC for 48 hours. Brief noradrenaline support (<24h) on day 1.",
    progress: "Afebrile for 48 hours. Oxygen weaned to 2 L/min nasal prong. Creatinine improving.",
    currentCondition: { bloodPressure: "118/72", heartRate: "88", respiratoryRate: "20", spo2: "96", oxygenModality: "Nasal prong 2 L/min", avpu: "Alert", other: "Haemodynamically stable off vasopressors." },
    interventions: ["Oxygen therapy", "HFNC", "Vasopressor/inotrope", "Central venous catheter", "Antimicrobial therapy"],
    devices: "Right IJ central venous catheter inserted 29/09.\nRight IJ CVC (day 7) — plan removal before transfer. Peripheral IV left forearm.",
    problems: [
      { id: uid(), problem: "Severe CAP", status: "Clinically improving", treatment: "IV ceftriaxone + azithromycin (day 6)", next: "Review IV-to-oral switch tomorrow" },
      { id: uid(), problem: "AKI", status: "Creatinine improving (312 → 148)", treatment: "Fluid balance, avoid nephrotoxins", next: "Repeat renal profile tomorrow" },
      { id: uid(), problem: "Type 1 respiratory failure", status: "Resolved", treatment: "Oxygen weaned", next: "Monitor oxygen requirement" },
    ],
    pending: [
      { id: uid(), task: "Blood culture (29/09)", status: "Pending final report", action: "Review and adjust antibiotics if positive", responsible: "Receiving ward MO", timing: "Within 24h", done: false },
      { id: uid(), task: "CVC removal", status: "Not done", action: "Remove CVC, send tip for culture if febrile", responsible: "HDW team", timing: "Before transfer", done: false },
    ],
    meds: [
      { id: uid(), name: "Ceftriaxone", dose: "2 g", route: "IV", freq: "OD", status: "New", note: "CAP — day 6 of 7, review 05/10" },
      { id: uid(), name: "Metformin", dose: "500 mg", route: "PO", freq: "BD", status: "Stop", note: "Withheld due to AKI" },
      { id: uid(), name: "Amlodipine", dose: "5 mg", route: "PO", freq: "OD", status: "Continue", note: "" },
    ],
    investigations: [
      { id: uid(), date: "2026-10-04", details: "Chest X-ray: right lower-lobe consolidation; no pleural effusion." },
      { id: uid(), date: "2026-10-05", details: "Renal profile: creatinine 148 µmol/L, improving from 312 µmol/L." },
    ],
    transfer: { ...p.transfer, readiness: "Preparing", blockers: ["WAIT BED", "WAIT RESULT"], destination: "General Medical Ward", oxygen: "Nasal prong 2 L/min, target SpO2 94–98%", monitoring: "4-hourly vital signs, strict input/output", mobility: "Ambulant with assistance", nutrition: "Diabetic diet", isolation: "None", escalation: "Call medical MO if SpO2 <92% on 4 L/min, SBP <90, or urine output <0.5 ml/kg/h for 4h" },
  };
}

async function writeEnvelope(next: VaultEnvelope) {
  const serialized = JSON.stringify(next);
  localStorage.setItem(VAULT_KEY, serialized);
  const check = parseVaultEnvelope(localStorage.getItem(VAULT_KEY) ?? "");
  if (check.records.data !== next.records.data) throw new Error("Encrypted storage verification failed.");
  vaultEnvelope = next;
}

function persist() {
  if (!unlockedVault || !vaultEnvelope || storageError) return;
  const snapshot = JSON.stringify(db);
  const key = unlockedVault.key;
  persistQueue = persistQueue.then(async () => {
    if (!vaultEnvelope) return;
    const next = { ...await saveVaultRecords(vaultEnvelope, key, JSON.parse(snapshot) as unknown), schema: SCHEMA };
    await writeEnvelope(next);
  }).catch((error: unknown) => {
    storageError = `Encrypted save failed: ${(error as Error).message || "device storage is unavailable"}`;
  }).then(() => notify());
  notify();
}

function installUnlocked(session: UnlockedVault) {
  const validated = validateDB(session.records);
  db = validated;
  vaultEnvelope = { ...session.envelope, schema: SCHEMA };
  unlockedVault = { ...session, records: validated, envelope: vaultEnvelope };
  currentUser = session.account;
  storageError = null;
  vaultStatus = "unlocked";
  if (!isRecord(session.records) || session.records.schema !== SCHEMA || session.envelope.schema !== SCHEMA) persist();
  notify();
}

export function useDB() {
  const [, force] = useState(0);
  useEffect(() => {
    const subscriber = () => force((revision) => revision + 1);
    subs.add(subscriber);
    // Subscribe first so the initial bootstrap notification cannot be missed.
    bootstrapVault();
    return () => { subs.delete(subscriber); };
  }, []);
  const ready = vaultStatus === "unlocked" && !!unlockedVault;
  return {
    ready,
    patients: ready ? db.patients : [],
    storageError,
    vaultStatus,
    legacyDataFound,
    currentUser,
    accounts: vaultEnvelope?.accounts ?? [],
  };
}

export async function createLocalVault(name: string, password: string) {
  bootstrapVault();
  if (vaultStatus !== "setup") throw new Error("The local vault has already been set up.");
  const initialDB = legacyDataFound ? readLegacyDB() : { schema: SCHEMA, patients: [demoPatient()] };
  const created = await createVault(name, password, initialDB, SCHEMA);
  await writeEnvelope(created.envelope);
  // Verify from the persisted representation before removing the legacy plaintext copy.
  const persisted = parseVaultEnvelope(localStorage.getItem(VAULT_KEY) ?? "");
  const verified = await unlockVault(persisted, name, password);
  validateDB(verified.records);
  if (legacyDataFound) localStorage.removeItem(KEY);
  db = validateDB(verified.records);
  vaultEnvelope = persisted;
  unlockedVault = { ...verified, envelope: persisted };
  currentUser = verified.account;
  vaultStatus = "recovery-pending";
  storageError = null;
  notify();
  return created.recoveryCode;
}

export async function unlockLocalVault(name: string, password: string) {
  bootstrapVault();
  if (!vaultEnvelope) throw new Error(storageError ?? "No encrypted vault is set up on this device.");
  const session = await unlockVault(vaultEnvelope, name, password);
  installUnlocked(session);
}

export async function recoverLocalVault(name: string, recoveryCode: string, newPassword: string) {
  bootstrapVault();
  if (!vaultEnvelope) throw new Error(storageError ?? "No encrypted vault is available to recover.");
  const recovered = await recoverVault(vaultEnvelope, name, recoveryCode, newPassword);
  await writeEnvelope(recovered.envelope);
  installUnlocked({ ...recovered.unlocked, envelope: recovered.envelope });
  vaultStatus = "recovery-pending";
  notify();
  return recovered.recoveryCode;
}

export function confirmRecoveryKeySaved() {
  if (vaultStatus !== "recovery-pending") return;
  vaultStatus = "unlocked";
  notify();
}

export async function lockVault() {
  if (vaultStatus !== "unlocked") return;
  await persistQueue;
  unlockedVault = null;
  currentUser = null;
  db = { schema: SCHEMA, patients: [] };
  vaultStatus = "locked";
  storageError = null;
  notify();
}

export async function addClinicianAccount(name: string, password: string) {
  if (!unlockedVault || !vaultEnvelope || currentUser?.role !== "administrator") throw new Error("Only the vault administrator can add clinicians.");
  await persistQueue;
  const next = await addVaultAccount(vaultEnvelope, unlockedVault.key, name, password);
  await writeEnvelope(next);
  unlockedVault = { ...unlockedVault, envelope: next };
  notify();
}

export async function removeClinicianAccount(accountId: string, recoveryCode: string) {
  if (!unlockedVault || !vaultEnvelope || currentUser?.role !== "administrator") throw new Error("Only the vault administrator can remove clinicians.");
  await persistQueue;
  const result = await removeVaultAccount(vaultEnvelope, unlockedVault.key, db, accountId, recoveryCode);
  await writeEnvelope(result.envelope);
  unlockedVault = { ...unlockedVault, key: result.key, envelope: result.envelope };
  notify();
  return result.recoveryCode;
}

export function addPatient(): string {
  const p = blankPatient();
  if (storageError || vaultStatus !== "unlocked") return "";
  db.patients = [p, ...db.patients];
  persist();
  return p.id;
}

export function updatePatient(id: string, fn: (p: Patient) => Patient) {
  if (storageError || vaultStatus !== "unlocked") return;
  db.patients = db.patients.map((p) => (p.id === id ? { ...fn(p), updatedAt: now() } : p));
  persist();
}

export function deletePatient(id: string) {
  if (storageError || vaultStatus !== "unlocked") return;
  db.patients = db.patients.filter((p) => p.id !== id);
  persist();
}

export async function exportBackup() {
  if (!unlockedVault || !vaultEnvelope) throw new Error("Unlock the vault before creating a backup.");
  await persistQueue;
  return JSON.stringify(vaultEnvelope, null, 2);
}

export async function previewEncryptedBackup(text: string, name: string, password: string) {
  const incoming = parseVaultEnvelope(text);
  if (incoming.schema > SCHEMA) throw new Error("This backup was created by a newer app version.");
  const source = await unlockVault(incoming, name, password);
  const restored = validateDB(source.records);
  return { patients: restored.patients, exportedAt: incoming.updatedAt, schema: incoming.schema };
}

export async function restoreEncryptedBackup(text: string, name: string, password: string) {
  if (!unlockedVault || !vaultEnvelope) throw new Error("Unlock this device's vault before restoring a backup.");
  const incoming = parseVaultEnvelope(text);
  if (incoming.schema > SCHEMA) throw new Error("This backup was created by a newer app version.");
  const source = await unlockVault(incoming, name, password);
  const restored = validateDB(source.records);
  const next = await saveVaultRecords(vaultEnvelope, unlockedVault.key, restored);
  await writeEnvelope(next);
  db = restored;
  unlockedVault = { ...unlockedVault, envelope: next, records: restored };
  storageError = null;
  notify();
  return restored.patients.length;
}

export async function createTransferPackage(patientIds: string[]) {
  if (vaultStatus !== "unlocked") throw new Error("Unlock the vault before preparing a transfer.");
  const selected = db.patients.filter((patient) => patientIds.includes(patient.id));
  if (!selected.length) throw new Error("Choose at least one patient record.");
  return createTransferFile(selected, SCHEMA, now());
}

export interface TransferPreview { id: string; patient: Patient; conflict: boolean }
export interface DecryptedTransfer { createdAt: string; schema: number; records: TransferPreview[] }

export async function inspectTransferPackage(text: string): Promise<DecryptedTransfer> {
  if (vaultStatus !== "unlocked") throw new Error("Unlock this device's vault before opening a transfer.");
  const transfer = parseTransferFile(text);
  if (transfer.schema > SCHEMA) throw new Error("This transfer was created by a newer app version.");
  const incomingDB = validateDB({ schema: transfer.schema, patients: transfer.records });
  return {
    createdAt: transfer.createdAt,
    schema: transfer.schema,
    records: incomingDB.patients.map((patient) => {
      const existing = db.patients.find((local) => local.id === patient.id);
      return { id: patient.id, patient, conflict: !!existing && JSON.stringify(existing) !== JSON.stringify(patient) };
    }),
  };
}

export async function applyTransfer(preview: DecryptedTransfer, decisions: Record<string, "keep-local" | "use-transfer">) {
  if (vaultStatus !== "unlocked") throw new Error("Unlock the vault before applying a transfer.");
  const next = [...db.patients];
  let added = 0;
  let replaced = 0;
  for (const item of preview.records) {
    const index = next.findIndex((patient) => patient.id === item.id);
    if (index < 0) { next.unshift(item.patient); added++; continue; }
    const local = next[index];
    if (!local || JSON.stringify(local) === JSON.stringify(item.patient) || decisions[item.id] === "keep-local") continue;
    if (decisions[item.id] !== "use-transfer") throw new Error("Resolve every conflicting patient record before applying the transfer.");
    next[index] = preserveFinalDocuments(local, item.patient);
    replaced++;
  }
  db = { schema: SCHEMA, patients: next };
  persist();
  await persistQueue;
  if (storageError) throw new Error(storageError);
  return { added, replaced };
}

function preserveFinalDocuments(local: Patient, incoming: Patient): Patient {
  const docs = { ...incoming.docs };
  const preserve = (localState: DocState | undefined, incomingState: DocState | undefined): DocState | undefined => {
    if (!localState || localState.status !== "Final") return incomingState;
    const incomingHistory = incomingState?.history ?? [];
    const incomingFinal = incomingState?.status === "Final" && incomingState.version !== localState.version
      ? [{ status: "Final" as const, version: incomingState.version, author: incomingState.author, updatedAt: incomingState.updatedAt, checks: incomingState.checks, snapshot: incomingState.snapshot! }]
      : [];
    const localHistory = localState.history ?? [];
    const knownVersions = new Set(localHistory.map((entry) => `${entry.version}:${entry.updatedAt}`));
    const history = [...localHistory];
    for (const entry of [...incomingHistory, ...incomingFinal]) {
      const key = `${entry.version}:${entry.updatedAt}`;
      if (!knownVersions.has(key)) { history.push(entry); knownVersions.add(key); }
    }
    return { ...localState, history };
  };

  for (const type of ["transfer", "discharge"] as const) docs[type] = preserve(local.docs[type], incoming.docs[type]);
  const localReferralDocs = local.docs.referrals ?? {};
  const incomingReferralDocs = { ...(incoming.docs.referrals ?? {}) };
  for (const [id, state] of Object.entries(localReferralDocs)) {
    if (state?.status === "Final") incomingReferralDocs[id] = preserve(state, incomingReferralDocs[id]);
  }
  if (Object.keys(incomingReferralDocs).length) docs.referrals = incomingReferralDocs;
  return { ...incoming, docs };
}
