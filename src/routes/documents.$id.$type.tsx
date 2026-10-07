import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { updatePatient, useDB } from "@/lib/hdw/store";
import { DOC_LABEL, type CurrentCondition, type DocState, type DocType, type Patient } from "@/lib/hdw/types";
import { selectDischargeDocumentData, selectReferralDocumentData, selectTransferDocumentData } from "@/lib/hdw/document-data";

export const Route = createFileRoute("/documents/$id/$type")({
  validateSearch: (search: Record<string, unknown>) => ({ referralId: typeof search.referralId === "string" ? search.referralId : undefined }),
  head: () => ({
    meta: [
      { title: "Clinical Document — HDW CONNECT" },
      { name: "description", content: "Generate, verify and print referral, transfer and discharge documents from one structured record." },
      { property: "og:title", content: "Clinical Document — HDW CONNECT" },
      { property: "og:description", content: "Generate, verify and print referral, transfer and discharge documents from one structured record." },
    ],
  }),
  component: DocPage,
});

const CHECKS: Record<DocType, string[]> = {
  referral: ["Patient identity confirmed", "Correct service / specialty", "Allergy status checked", "Clinical question is clear", "Urgency appropriate", "Final clinician review"],
  transfer: ["Patient identity confirmed", "Transfer destination confirmed", "Allergy status checked", "Medication reconciliation checked", "Problem list up to date", "Pending tasks have responsible person", "Lines / devices status reviewed", "Escalation plan stated", "Final clinician review"],
  discharge: ["Patient identity confirmed", "Allergy status checked", "Medication reconciliation checked", "Pending results have responsible person", "Follow-up arranged", "Patient information is in plain language", "Final clinician review"],
};

const fmt = (d: string) => (d ? new Date(d).toLocaleString("en-MY", { dateStyle: "medium", ...(d.includes("T") ? { timeStyle: "short" } : {}) }) : "");

function DocPage() {
  const { id, type } = Route.useParams();
  const { referralId } = Route.useSearch();
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const { ready, patients } = useDB();
  const live = patients.find((x) => x.id === id);
  if (!ready) return null;
  const dt = type as DocType;
  const legacyReferral = dt === "referral" && referralId === "legacy";
  if (!live || !DOC_LABEL[dt]) return <main className="p-8">Not found. <Link to="/" className="underline">Back</Link></main>;
  if (dt === "referral" && (!referralId || (legacyReferral ? !live.docs.referral : !live.referrals.some((r) => r.id === referralId) && !live.docs.referrals?.[referralId]?.snapshot))) {
    return <main className="p-8">Choose a referral from the patient record. <Link to="/patients/$id" params={{ id }} className="underline">Back to record</Link></main>;
  }

  const state: DocState = (dt === "referral" ? legacyReferral ? live.docs.referral : live.docs.referrals?.[referralId!] : live.docs[dt]) ?? { status: "Draft", version: 1, author: "", updatedAt: "", checks: {}, history: [] };
  const save = (patch: Partial<DocState>) => {
    const nextState = { ...state, ...patch, updatedAt: new Date().toISOString() };
    updatePatient(id, (q) => {
      if (dt !== "referral") return { ...q, docs: { ...q.docs, [dt]: nextState } };
      if (legacyReferral) return { ...q, docs: { ...q.docs, referral: nextState } };
      return { ...q, docs: { ...q.docs, referrals: { ...q.docs.referrals, [referralId!]: nextState } } };
    });
  };
  const archived = state.history?.find((v) => v.version === viewVersion);
  const shown = archived ?? state;
  const isCurrent = !archived;
  const isFinal = shown.status === "Final";
  const p = isFinal && shown.snapshot ? shown.snapshot : live;
  const selectedReferral = dt === "referral" && !legacyReferral ? p.referrals.find((r) => r.id === referralId) : undefined;
  const referralData = selectedReferral ? selectReferralDocumentData(p, selectedReferral) : undefined;
  const transferData = dt === "transfer" ? selectTransferDocumentData(p) : undefined;
  const dischargeData = dt === "discharge" ? selectDischargeDocumentData(p) : undefined;
  const title = legacyReferral ? "Legacy Combined Referral" : dt === "referral" ? `Referral${selectedReferral?.service ? ` — ${selectedReferral.service}` : ""}` : dt === "discharge" ? "Clinical Discharge Summary" : DOC_LABEL[dt];
  const allChecked = CHECKS[dt].every((c) => shown.checks[c]);
  const startNewVersion = () => {
    if (state.status !== "Final") return;
    const { history = [], ...finalVersion } = state;
    save({ status: "Draft", version: state.version + 1, checks: {}, snapshot: undefined, history: [...history, finalVersion as DocState & { status: "Final"; snapshot: Patient }] });
    setViewVersion(null);
  };

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[1fr_300px]">
      <article className="doc-page mx-auto w-full border shadow-sm">
        <DocHeader p={p} title={title} />
        {legacyReferral && <LegacyReferral p={p} />}
        {dt === "referral" && !legacyReferral && referralData && <Referral data={referralData} />}
        {dt === "transfer" && transferData && <Transfer data={transferData} />}
        {dt === "discharge" && dischargeData && <Discharge data={dischargeData} />}
        <Signature state={shown} />
        {dt === "discharge" && (
          <div className="page-break mt-10 border-t-2 border-dashed pt-8 print:mt-0 print:border-0 print:pt-0">
            <DocHeader p={p} title="Patient Discharge Information" />
            {dischargeData && <PatientInfo data={dischargeData} />}
          </div>
        )}
      </article>

      <aside className="no-print space-y-4">
        <Link to="/patients/$id" params={{ id }} className="btn btn-outline w-full justify-center">
          ← Return to patient record
        </Link>
        <div className="panel p-4">
          <p className="label-caps mt-3">Document status</p>
          <p className="font-serif text-xl font-semibold text-primary">{shown.status} · v{shown.version}{archived ? " · archived" : ""}</p>
          {shown.updatedAt && <p className="text-xs text-muted-foreground">Last change {fmt(shown.updatedAt)}</p>}
          {!isCurrent && <button className="mt-2 text-sm underline" onClick={() => setViewVersion(null)}>Return to current version</button>}
          <label className="mt-3 block">
            <span className="label-caps">Clinician (author)</span>
            <input className="field mt-1" disabled={!isCurrent || isFinal} value={shown.author} onChange={(e) => save({ author: e.target.value })} />
          </label>
        </div>

        {!!state.history?.length && <div className="panel p-4"><p className="label-caps">Finalised versions</p><div className="mt-2 flex flex-wrap gap-2">{state.history.map((v) => <button key={v.version} className="btn btn-outline" onClick={() => setViewVersion(v.version)}>View v{v.version} · {fmt(v.updatedAt)}</button>)}</div></div>}

        <div className="panel p-4">
          <p className="label-caps">Verification checklist</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {CHECKS[dt].map((c) => (
              <li key={c}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" disabled={!isCurrent || isFinal} checked={!!shown.checks[c]} onChange={(e) => save({ checks: { ...state.checks, [c]: e.target.checked } })} />
                  {c}
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel space-y-2 p-4">
          {isCurrent && state.status === "Draft" && <button className="btn w-full justify-center" onClick={() => save({ status: "Reviewed" })}>Mark as Reviewed</button>}
          {isCurrent && state.status === "Reviewed" && (
            <button className="btn w-full justify-center" disabled={!allChecked || !state.author} onClick={() => save({ status: "Verified" })}>Mark as Verified</button>
          )}
          {isCurrent && state.status === "Reviewed" && (!allChecked || !state.author) && <p className="text-xs text-muted-foreground">Complete the checklist and author name to verify.</p>}
          {isCurrent && state.status === "Verified" && (
            <button className="btn w-full justify-center" onClick={() => save({ status: "Final", snapshot: structuredClone(live) })}>Finalise (lock this version)</button>
          )}
          {isFinal && (
            <>
              <p className="text-xs text-muted-foreground">This version is locked. Later record changes will not alter it.</p>
              {isCurrent && <button className="btn btn-outline w-full justify-center" onClick={startNewVersion}>Start new version</button>}
            </>
          )}
          <button className="btn btn-outline w-full justify-center" onClick={() => window.print()}>Print / Save as PDF</button>
        </div>
      </aside>
    </main>
  );
}

/* ---------- rendering helpers ---------- */

function V({ v }: { v?: string | undefined }) {
  return v?.trim() ? <span className="whitespace-pre-wrap">{v}</span> : <em className="text-muted-foreground">Not recorded</em>;
}
function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="doc-section">
      <h3 className="border-b border-foreground/40 pb-0.5 font-sans text-[9pt] font-bold uppercase tracking-wider">{title}</h3>
      <div className="mt-1">{children}</div>
    </section>
  );
}
function Row({ k, v }: { k: string; v?: string | undefined }) {
  return <div className="grid grid-cols-[150px_1fr] gap-2 py-0.5"><span className="font-semibold">{k}</span><V v={v} /></div>;
}
function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  if (!rows.length) return <em className="text-muted-foreground">None recorded</em>;
  return (
    <table className="w-full border-collapse text-[9.5pt]">
      <thead><tr>{head.map((h) => <th key={h} className="border border-foreground/40 bg-muted px-1.5 py-1 text-left">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="break-inside-avoid">{r.map((c, j) => <td key={j} className="border border-foreground/40 px-1.5 py-1 align-top whitespace-pre-wrap">{c || "—"}</td>)}</tr>)}</tbody>
    </table>
  );
}
function InvestigationTable({ rows }: { rows: Patient["investigations"] }) {
  return <Table head={["Date", "Investigation"]} rows={rows.map((item) => [fmt(item.date), item.details])} />;
}
function CurrentConditionRows({ condition }: { condition: CurrentCondition }) {
  return <>
    <Row k="Blood pressure" v={condition.bloodPressure ? `${condition.bloodPressure} mmHg` : ""} />
    <Row k="Heart rate" v={condition.heartRate ? `${condition.heartRate} /min` : ""} />
    <Row k="Respiratory rate" v={condition.respiratoryRate ? `${condition.respiratoryRate} /min` : ""} />
    <Row k="SpO₂" v={condition.spo2 ? `${condition.spo2}%` : ""} />
    <Row k="Oxygen modality" v={condition.oxygenModality} />
    <Row k="AVPU" v={condition.avpu} />
    <Row k="Other information" v={condition.other} />
  </>;
}

function DocHeader({ p, title }: { p: Patient; title: string }) {
  return (
    <header>
      <div className="flex items-end justify-between border-b-2 border-foreground pb-2">
        <div>
          <p className="text-[8.5pt] uppercase tracking-wider">Medical Department · Hospital Kuala Lumpur</p>
          <p className="text-[8.5pt]">High Dependency Ward — Acute Internal Medicine</p>
        </div>
        <h2 className="text-right text-[15pt] font-bold">{title}</h2>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 border border-foreground/60 p-2 text-[9.5pt]">
        <Row k="Name" v={p.name} /><Row k="MRN / RN" v={p.mrn} />
        <Row k="IC / Passport" v={p.ic} /><Row k="Age / Sex" v={[p.age, p.sex].filter(Boolean).join(" / ")} />
        <Row k="Admitted" v={fmt(p.admissionDate)} /><Row k="HDW admission" v={fmt(p.hdwAdmissionDate)} />
      </div>
      <div className="mt-2 border-2 border-foreground px-2 py-1 font-bold">
        ALLERGIES / ADR: {p.allergies?.trim() ? p.allergies : "NOT RECORDED — CONFIRM BEFORE PRESCRIBING"}
      </div>
    </header>
  );
}

function Signature({ state }: { state: DocState }) {
  return (
    <div className="doc-section mt-8 grid grid-cols-2 gap-8 text-[9.5pt]">
      <div><div className="h-10 border-b border-foreground" /><p>Clinician: {state.author || "________________"}</p></div>
      <div><div className="h-10 border-b border-foreground" /><p>Date/time · Document v{state.version} ({state.status})</p></div>
    </div>
  );
}

function Referral({ data }: { data: ReturnType<typeof selectReferralDocumentData> }) {
  const { patient: p, referral: r, sections } = data;
  return (
    <>
      <Sec title="Referral details">
        <Row k="Referred to" v={r.service} /><Row k="Urgency" v={r.urgency} />
        <Row k="Referring team" v={p.team} /><Row k="Referring clinician" v={r.clinician} /><Row k="Contact" v={r.contact} />
      </Sec>
      <Sec title="Reason for referral"><V v={r.reason} /></Sec>
      <Sec title="Clinical question / request"><p className="font-semibold"><V v={r.question} /></p><div className="mt-1"><V v={r.request} /></div></Sec>
      {sections.diagnoses && <Sec title="Main diagnoses"><V v={sections.diagnoses.main} /></Sec>}
      {sections.comorbidities !== undefined && <Sec title="Comorbidities"><V v={sections.comorbidities} /></Sec>}
      {sections.history && <Sec title="Relevant history"><V v={[sections.history.presentingProblem, sections.history.hdwReason].filter(Boolean).join("\n")} /></Sec>}
      {sections.currentCondition !== undefined && <Sec title="Current clinical status"><CurrentConditionRows condition={sections.currentCondition} /></Sec>}
      {sections.findings !== undefined && <Sec title="Relevant findings"><V v={sections.findings} /></Sec>}
      {sections.investigations !== undefined && <Sec title="Relevant investigations"><InvestigationTable rows={sections.investigations} /></Sec>}
      {sections.medications && <Sec title="Current medications"><Table head={["Medication", "Dose / route / freq", "Status", "Note"]} rows={sections.medications.map((m) => [m.name, [m.dose, m.route, m.freq].filter(Boolean).join(" "), m.status, m.note])} /></Sec>}
      {sections.devices !== undefined && <Sec title="Devices / support"><V v={sections.devices} /></Sec>}
      {sections.treatment !== undefined && <Sec title="Treatment already given"><V v={sections.treatment} /></Sec>}
      {r.outcome && <Sec title="Referral outcome"><V v={r.outcome} /></Sec>}
    </>
  );
}

function LegacyReferral({ p }: { p: Patient }) {
  return <>{p.referrals.map((r, i) => <div key={r.id} className={i > 0 ? "page-break" : ""}>
    <div className="doc-section mt-4 border-2 border-foreground px-2 py-1 font-bold uppercase">Referral {i + 1}{r.service ? ` — ${r.service}` : ""}</div>
    <Sec title="Referral details"><Row k="Referred to" v={r.service} /><Row k="Urgency" v={r.urgency} /><Row k="Referring team" v={p.team} /><Row k="Referring clinician" v={r.clinician} /><Row k="Contact" v={r.contact} /></Sec>
    <Sec title="Reason for referral"><V v={r.reason} /></Sec>
    <Sec title="Clinical question / request"><p className="font-semibold"><V v={r.question} /></p><div className="mt-1"><V v={r.request} /></div></Sec>
    <Sec title="Relevant history & findings"><V v={[p.presentingProblem, r.findings].filter(Boolean).join("\n")} /></Sec>
      <Sec title="Relevant investigations"><V v={r.legacyInvestigations} /></Sec>
    <Sec title="Treatment given"><V v={r.treatmentTried} /></Sec>
  </div>)}</>;
}

function Transfer({ data }: { data: ReturnType<typeof selectTransferDocumentData> }) {
  const { patient: p } = data;
  const t = p.transfer;
  return (
    <>
      <Sec title="Transfer details">
        <Row k="Destination" v={t.destination} />
        <Row k="Date / time" v={fmt(t.datetime)} /><Row k="Responsible service" v={t.responsible} />
      </Sec>
      <Sec title="Reason for HDW admission"><V v={p.hdwReason} /></Sec>
      <Sec title="Main diagnoses"><Row k="Main diagnoses" v={p.primaryDx} /></Sec>
      <Sec title="Significant HDW events & interventions">
        <V v={[p.events, p.interventions.length ? `HDW interventions: ${p.interventions.join(", ")}` : ""].filter(Boolean).join("\n")} />
      </Sec>
      <Sec title="Current condition"><CurrentConditionRows condition={p.currentCondition} /></Sec>
      <Sec title="Problem list"><Table head={["Problem", "Current status", "Current treatment", "Next action"]} rows={p.problems.map((x) => [x.problem, x.status, x.treatment, x.next])} /></Sec>
      <Sec title="Relevant investigations"><InvestigationTable rows={data.investigations} /></Sec>
      <Sec title="Medications"><Table head={["Medication", "Dose / route / freq", "Status", "Note"]} rows={data.medications.map((m) => [m.name, [m.dose, m.route, m.freq].filter(Boolean).join(" "), m.status, m.note])} /></Sec>
      <Sec title="Pending investigations & outstanding tasks"><Table head={["Item", "Status", "Action", "Responsible", "Timing"]} rows={data.pending.map((t) => [t.task, t.status, t.action, t.responsible, t.timing])} /></Sec>
      <Sec title="Care requirements">
        <Row k="Oxygen" v={t.oxygen} /><Row k="Monitoring" v={t.monitoring} /><Row k="Nursing" v={t.nursing} />
        <Row k="Mobility" v={t.mobility} /><Row k="Nutrition" v={t.nutrition} /><Row k="Isolation" v={t.isolation} />
        <Row k="Lines / devices / procedures" v={p.devices} />
      </Sec>
      <Sec title="Escalation instructions"><p className="font-semibold"><V v={t.escalation} /></p></Sec>
      <Sec title="Handover"><Row k="Acknowledged by" v={t.handover} /></Sec>
    </>
  );
}

function Discharge({ data }: { data: ReturnType<typeof selectDischargeDocumentData> }) {
  const { patient: p } = data;
  const d = p.discharge;
  return (
    <>
      <Sec title="Episode"><Row k="Discharge date" v={fmt(d.date)} /><Row k="Responsible service" v={p.team} /><Row k="Consultant" v={p.consultant} /></Sec>
      <Sec title="Reason for admission"><V v={p.presentingProblem} /></Sec>
      <Sec title="Diagnoses"><Row k="Main diagnoses" v={p.primaryDx} /><Row k="Comorbidities" v={p.comorbidities} /></Sec>
      <Sec title="Significant HDW events & interventions"><V v={[p.events, p.interventions.length ? `HDW interventions: ${p.interventions.join(", ")}` : "", p.devices].filter(Boolean).join("\n")} /></Sec>
      <Sec title="Relevant investigations"><InvestigationTable rows={data.investigations} /></Sec>
      <Sec title="Clinical progress"><V v={p.progress} /></Sec>
      <Sec title="Condition at discharge"><V v={d.condition} /></Sec>
      <Sec title="Medication reconciliation"><Table head={["Medication", "Dose / route / freq", "Status", "Note"]} rows={data.medications.map((m) => [m.name, [m.dose, m.route, m.freq].filter(Boolean).join(" "), m.status, m.note])} /></Sec>
      <Sec title="Pending results"><Table head={["Item", "Status", "Action", "Responsible", "Timing"]} rows={data.pending.map((t) => [t.task, t.status, t.action, t.responsible, t.timing])} /></Sec>
      <Sec title="Follow-up"><Row k="Clinic / specialty" v={d.followUp} /><Row k="Repeat investigations" v={d.repeatInv} /><Row k="Wound / device care" v={d.woundCare} /><Row k="Rehabilitation" v={d.rehab} /><Row k="Medical certificate" v={d.mc} /></Sec>
    </>
  );
}

function PatientInfo({ data }: { data: ReturnType<typeof selectDischargeDocumentData> }) {
  const { patient: p } = data;
  const d = p.discharge;
  return (
    <div className="text-[11pt]">
      <Sec title="What happened during your stay"><V v={d.patientSummary} /></Sec>
      <Sec title="Your medicines">
        <Table head={["Medicine", "How to take", "Change"]} rows={data.patientMedications.map((m) => [m.name, [m.dose, m.route, m.freq].filter(Boolean).join(" "), m.status === "Continue" ? "No change" : m.status])} />
        {data.stoppedMedications.length > 0 && <p className="mt-2 font-semibold">STOP taking: {data.stoppedMedications.map((m) => m.name).join(", ")}</p>}
      </Sec>
      <Sec title="Instructions"><V v={d.instructions} /></Sec>
      <Sec title="Appointments & tests"><V v={[d.followUp, d.repeatInv].filter(Boolean).join("\n")} /></Sec>
      <Sec title="Get urgent medical help if you have">
        <div className="border-2 border-foreground p-2 font-semibold"><V v={d.warnings} /><p className="mt-1">In an emergency, call 999 or go to the nearest Emergency Department.</p></div>
      </Sec>
    </div>
  );
}
