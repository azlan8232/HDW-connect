export type DocType = "referral" | "transfer" | "discharge";
export type DocStatus = "Draft" | "Reviewed" | "Verified" | "Final";
export type MedStatus = "Continue" | "Stop" | "Changed" | "New" | "Temporary";
export const REFERRAL_SECTIONS = ["diagnoses", "comorbidities", "history", "currentCondition", "findings", "investigations", "medications", "devices", "treatment"] as const;
export type ReferralSection = (typeof REFERRAL_SECTIONS)[number];

export const READINESS = [
  "Not Ready",
  "Preparing",
  "Clinically Ready",
  "Documentation Ready",
  "Destination Confirmed",
  "Ready to Transfer/Discharge",
  "Departed",
  "Handover Completed",
] as const;
export type Readiness = (typeof READINESS)[number];

export const BLOCKERS = [
  "WAIT MEDICATION",
  "WAIT BED",
  "WAIT RESULT",
  "WAIT DOCUMENTATION",
  "WAIT TRANSPORT",
  "WAIT PDL",
  "WAIT CLINICAL REVIEW",
  "WAIT FAMILY",
  "WAIT FOLLOW-UP ARRANGEMENT",
] as const;

export const INTERVENTIONS = [
  "Oxygen therapy",
  "HFNC",
  "NIV",
  "Invasive ventilation",
  "Vasopressor/inotrope",
  "Renal replacement therapy",
  "Central venous catheter",
  "Arterial line",
  "Antimicrobial therapy",
  "Transfusion",
  "POCUS",
] as const;

export interface Problem { id: string; problem: string; status: string; treatment: string; next: string }
export interface Pending { id: string; task: string; status: string; action: string; responsible: string; timing: string; done: boolean }
export interface Med { id: string; name: string; dose: string; route: string; freq: string; status: MedStatus; note: string }
export interface Investigation { id: string; date: string; details: string }
export type AVPU = "Alert" | "Reacts to voice" | "Reacts to pain" | "Unresponsive";
export interface CurrentCondition { bloodPressure: string; heartRate: string; respiratoryRate: string; spo2: string; oxygenModality: string; avpu: AVPU | ""; other: string }

export interface Referral { id: string; service: string; urgency: string; reason: string; question: string; findings: string; legacyInvestigations?: string; investigationIds: string[]; treatmentTried: string; request: string; clinician: string; contact: string; outcome: string }

export interface ArchivedDocState {
  status: "Final";
  version: number;
  author: string;
  updatedAt: string;
  checks: Record<string, boolean>;
  snapshot: Patient;
}

export interface DocState {
  status: DocStatus;
  version: number;
  author: string;
  updatedAt: string;
  checks: Record<string, boolean>;
  snapshot?: Patient | undefined; // frozen record once Final
  history?: ArchivedDocState[];
}

export interface ReferralRecord extends Referral {
  include: ReferralSection[];
}

export interface Patient {
  id: string;
  name: string; mrn: string; ic: string; age: string; sex: string; bed: string;
  admissionDate: string; hdwAdmissionDate: string; source: string; team: string; consultant: string;
  allergies: string;
  presentingProblem: string; hdwReason: string; primaryDx: string; comorbidities: string;
  events: string; progress: string; currentCondition: CurrentCondition;
  interventions: string[]; devices: string;
  problems: Problem[]; pending: Pending[]; meds: Med[]; investigations: Investigation[];
  referrals: ReferralRecord[];
  transfer: { destination: string; datetime: string; oxygen: string; monitoring: string; nursing: string; mobility: string; nutrition: string; isolation: string; escalation: string; responsible: string; handover: string; readiness: Readiness; blockers: string[] };
  discharge: { date: string; condition: string; followUp: string; repeatInv: string; woundCare: string; rehab: string; mc: string; patientSummary: string; instructions: string; warnings: string; readiness: Readiness; blockers: string[] };
  docs: Partial<Record<DocType, DocState>> & { referrals?: Partial<Record<string, DocState>> };
  createdAt: string; updatedAt: string;
}

export const DOC_LABEL: Record<DocType, string> = {
  referral: "Referral Document",
  transfer: "Transfer Document",
  discharge: "Discharge Home Document",
};
