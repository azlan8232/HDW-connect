import type { CurrentCondition, Investigation, Med, Patient, Pending, ReferralRecord } from "./types";

export interface ReferralDocumentData {
  patient: Patient;
  referral: ReferralRecord;
  sections: {
    diagnoses?: { main: string };
    comorbidities?: string;
    history?: { presentingProblem: string; hdwReason: string };
    currentCondition?: CurrentCondition;
    findings?: string;
    investigations?: Investigation[];
    medications?: Med[];
    devices?: string;
    treatment?: string;
  };
}

export interface TransferDocumentData {
  patient: Patient;
  pending: Pending[];
  medications: Med[];
  investigations: Investigation[];
}

export interface DischargeDocumentData {
  patient: Patient;
  pending: Pending[];
  medications: Med[];
  patientMedications: Med[];
  stoppedMedications: Med[];
  investigations: Investigation[];
}

export function selectReferralDocumentData(patient: Patient, referral: ReferralRecord): ReferralDocumentData {
  const sections: ReferralDocumentData["sections"] = {};
  for (const section of referral.include) {
    switch (section) {
      case "diagnoses": sections.diagnoses = { main: patient.primaryDx }; break;
      case "comorbidities": sections.comorbidities = patient.comorbidities; break;
      case "history": sections.history = { presentingProblem: patient.presentingProblem, hdwReason: patient.hdwReason }; break;
      case "currentCondition": sections.currentCondition = patient.currentCondition; break;
      case "findings": sections.findings = referral.findings; break;
      case "investigations": sections.investigations = patient.investigations.filter((item) => referral.investigationIds.includes(item.id)); break;
      case "medications": sections.medications = patient.meds.filter((m) => m.status !== "Stop"); break;
      case "devices": sections.devices = patient.devices; break;
      case "treatment": sections.treatment = referral.treatmentTried; break;
    }
  }
  return { patient, referral, sections };
}

export function selectTransferDocumentData(patient: Patient): TransferDocumentData {
  return { patient, pending: patient.pending.filter((item) => !item.done), medications: patient.meds, investigations: patient.investigations };
}

export function selectDischargeDocumentData(patient: Patient): DischargeDocumentData {
  const stoppedMedications = patient.meds.filter((med) => med.status === "Stop");
  return {
    patient,
    pending: patient.pending.filter((item) => !item.done),
    medications: patient.meds,
    patientMedications: patient.meds.filter((med) => med.status !== "Stop"),
    stoppedMedications,
    investigations: patient.investigations,
  };
}
