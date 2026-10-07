import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { blankReferral, deletePatient, uid, updatePatient, useDB } from "@/lib/hdw/store";
import { BLOCKERS, INTERVENTIONS, READINESS, REFERRAL_SECTIONS, DOC_LABEL, type CurrentCondition, type DocType, type Investigation, type Med, type MedStatus, type Patient, type Pending, type Problem, type ReferralRecord } from "@/lib/hdw/types";
import { Grid, Panel, SelectField, TextField } from "@/components/hdw/Fields";

export const Route = createFileRoute("/patients/$id")({
  head: () => ({
    meta: [
      { title: "Patient Record — HDW CONNECT" },
      { name: "description", content: "Structured HDW patient record reused for referral, transfer and discharge documents." },
      { property: "og:title", content: "Patient Record — HDW CONNECT" },
      { property: "og:description", content: "Structured HDW patient record reused for referral, transfer and discharge documents." },
    ],
  }),
  component: PatientPage,
});

const SECTIONS = [
  ["episode", "Patient & Episode"], ["summary", "Clinical Summary"], ["investigations", "Relevant Investigations"], ["hdw", "HDW Interventions"],
  ["problems", "Problem List"], ["pending", "Pending Tasks"], ["meds", "Medications"],
  ["readiness", "Readiness"], ["referral", "Referral"], ["transfer", "Transfer"], ["discharge", "Discharge Home"],
] as const;

function PatientPage() {
  const { id } = Route.useParams();
  const { ready, patients } = useDB();
  const nav = useNavigate();
  const p = patients.find((x) => x.id === id);
  if (!ready) return null;
  if (!p) return <main className="mx-auto max-w-6xl p-8">Record not found. <Link to="/" className="underline">Back</Link></main>;

  const set = <K extends keyof Patient>(k: K, v: Patient[K]) => updatePatient(id, (q) => ({ ...q, [k]: v }));
  const sub = <G extends "transfer" | "discharge">(g: G, k: keyof Patient[G]) => (v: string) =>
    updatePatient(id, (q) => ({ ...q, [g]: { ...q[g], [k]: v } }));
  const ref = (rid: string, k: "service" | "urgency" | "reason" | "question" | "findings" | "treatmentTried" | "request" | "clinician" | "contact" | "outcome") => (v: string) =>
    updatePatient(id, (q) => ({ ...q, referrals: q.referrals.map((r) => (r.id === rid ? { ...r, [k]: v } : r)) }));
  const t = (k: keyof Patient) => (v: string) => set(k, v as never);
  const condition = (k: keyof CurrentCondition) => (v: string) => updatePatient(id, (q) => ({ ...q, currentCondition: { ...q.currentCondition, [k]: v } as CurrentCondition }));

  function listOps<T extends { id: string }>(key: "problems" | "pending" | "meds") {
    const list = p![key] as unknown as T[];
    return {
      update: (i: string, patch: Partial<T>) => set(key, list.map((x) => (x.id === i ? { ...x, ...patch } : x)) as never),
      remove: (i: string) => set(key, list.filter((x) => x.id !== i) as never),
      add: (item: T) => set(key, [...list, item] as never),
    };
  }
  const probs = listOps<Problem>("problems");
  const pend = listOps<Pending>("pending");
  const meds = listOps<Med>("meds");
  const updateInvestigation = (iid: string, patch: Partial<Investigation>) => set("investigations", p.investigations.map((x) => x.id === iid ? { ...x, ...patch } : x));
  const addReferral = () => set("referrals", [...p.referrals, blankReferral()]);
  const setReadiness = (path: "transfer" | "discharge", readiness: Patient["transfer"]["readiness"]) => updatePatient(id, (q) => path === "transfer"
    ? { ...q, transfer: { ...q.transfer, readiness } }
    : { ...q, discharge: { ...q.discharge, readiness } });
  const toggleBlocker = (path: "transfer" | "discharge", blocker: string) => updatePatient(id, (q) => {
    const current = q[path].blockers;
    const blockers = current.includes(blocker) ? current.filter((x) => x !== blocker) : [...current, blocker];
    return path === "transfer" ? { ...q, transfer: { ...q.transfer, blockers } } : { ...q, discharge: { ...q.discharge, blockers } };
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="panel sticky top-[60px] z-10 flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">{p.name || "Unnamed patient"}</h1>
          <p className="text-sm text-muted-foreground">{[p.mrn, p.bed, p.primaryDx].filter(Boolean).join(" · ")}</p>
          <p className={`mt-1 text-xs font-semibold ${p.allergies ? "text-destructive" : "text-warning"}`}>
            {p.allergies ? `ALLERGY: ${p.allergies}` : "Allergy status not recorded"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline" onClick={addReferral}>+ Add referral</button>
          {(Object.keys(DOC_LABEL) as DocType[]).filter((d) => d !== "referral").map((d) => (
            <Link key={d} to="/documents/$id/$type" params={{ id, type: d }} className="btn">
              {DOC_LABEL[d].replace(" Document", "")}
              {p.docs[d] && <span className="rounded-sm bg-accent px-1 text-[10px] text-accent-foreground">{p.docs[d]!.status}</span>}
            </Link>
          ))}
          {p.referrals.map((r) => (
            <Link key={r.id} to="/documents/$id/$type" params={{ id, type: "referral" }} search={{ referralId: r.id }} className="btn">
              Referral{r.service ? ` · ${r.service}` : ""}
              {p.docs.referrals?.[r.id] && <span className="rounded-sm bg-accent px-1 text-[10px] text-accent-foreground">{p.docs.referrals[r.id]!.status}</span>}
            </Link>
          ))}
          {p.docs.referral && <Link to="/documents/$id/$type" params={{ id, type: "referral" }} search={{ referralId: "legacy" }} className="btn btn-outline">Legacy combined referral · v{p.docs.referral.version}</Link>}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[180px_1fr]">
        <nav className="no-print hidden lg:block">
          <ul className="sticky top-48 space-y-1 text-sm">
            {SECTIONS.map(([k, l]) => (
              <li key={k}><a href={`#${k}`} className="block rounded-sm px-2 py-1 hover:bg-secondary">{l}</a></li>
            ))}
          </ul>
        </nav>

        <div className="space-y-6">
          <Panel id="episode" title="Patient & Episode">
            <Grid>
              <TextField label="Name" value={p.name} onChange={t("name")} />
              <TextField label="MRN / RN" value={p.mrn} onChange={t("mrn")} />
              <TextField label="IC / Passport" value={p.ic} onChange={t("ic")} />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Age" value={p.age} onChange={t("age")} />
                <SelectField label="Sex" value={p.sex} options={["Male", "Female"]} onChange={t("sex")} />
              </div>
              <TextField label="Bed" value={p.bed} onChange={t("bed")} />
              <TextField label="Source of admission" value={p.source} onChange={t("source")} />
              <TextField label="Date of admission" type="date" value={p.admissionDate} onChange={t("admissionDate")} />
              <TextField label="Date of HDW admission" type="date" value={p.hdwAdmissionDate} onChange={t("hdwAdmissionDate")} />
              <TextField label="Primary team" value={p.team} onChange={t("team")} />
              <TextField label="Consultant" value={p.consultant} onChange={t("consultant")} />
            </Grid>
            <TextField label="Allergies / adverse drug reactions (write NKDA if none)" value={p.allergies} onChange={t("allergies")} />
          </Panel>

          <Panel id="summary" title="Clinical Summary">
            <TextField multiline label="Presenting problem" value={p.presentingProblem} onChange={t("presentingProblem")} />
            <TextField multiline label="Reason for HDW admission" value={p.hdwReason} onChange={t("hdwReason")} />
            <Grid>
              <TextField label="Main Diagnoses" value={p.primaryDx} onChange={t("primaryDx")} />
            </Grid>
            <TextField multiline label="Comorbidities" value={p.comorbidities} onChange={t("comorbidities")} />
            <TextField multiline label="Significant HDW events / complications" value={p.events} onChange={t("events")} />
            <TextField multiline label="Clinical progress" value={p.progress} onChange={t("progress")} />
            <div className="space-y-3">
              <p className="label-caps text-primary">Current condition</p>
              <Grid>
                <TextField label="Blood pressure (mmHg)" value={p.currentCondition.bloodPressure} onChange={condition("bloodPressure")} />
                <TextField label="Heart rate (/min)" value={p.currentCondition.heartRate} onChange={condition("heartRate")} />
                <TextField label="Respiratory rate (/min)" value={p.currentCondition.respiratoryRate} onChange={condition("respiratoryRate")} />
                <TextField label="SpO₂ (%)" value={p.currentCondition.spo2} onChange={condition("spo2")} />
                <TextField label="Oxygen modality" value={p.currentCondition.oxygenModality} onChange={condition("oxygenModality")} />
                <SelectField label="AVPU" value={p.currentCondition.avpu} options={["Alert", "Reacts to voice", "Reacts to pain", "Unresponsive"]} onChange={condition("avpu")} />
              </Grid>
              <TextField multiline label="Other information" value={p.currentCondition.other} onChange={condition("other")} />
            </div>
          </Panel>

          <Panel id="investigations" title="Relevant Investigations" subtitle="Record dated investigation results once and select the relevant entries for each referral.">
            {p.investigations.map((item) => (
              <div key={item.id} className="grid gap-3 rounded-sm border p-3 sm:grid-cols-[220px_1fr_auto] sm:items-end">
                <TextField label="Date" type="date" value={item.date} onChange={(v) => updateInvestigation(item.id, { date: v })} />
                <TextField multiline label="Investigations" value={item.details} onChange={(v) => updateInvestigation(item.id, { details: v })} />
                <button className="pb-2 text-left text-xs text-destructive" onClick={() => set("investigations", p.investigations.filter((x) => x.id !== item.id))}>Remove</button>
              </div>
            ))}
            <button className="btn btn-outline" onClick={() => set("investigations", [...p.investigations, { id: uid(), date: "", details: "" }])}>+ Add investigation</button>
          </Panel>

          <Panel id="hdw" title="HDW Interventions">
            <div className="flex flex-wrap gap-2">
              {INTERVENTIONS.map((i) => {
                const on = p.interventions.includes(i);
                return (
                  <button key={i} type="button" onClick={() => set("interventions", on ? p.interventions.filter((x) => x !== i) : [...p.interventions, i])}
                    className={`rounded-sm border px-2.5 py-1 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>{i}</button>
                );
              })}
            </div>
            <TextField multiline label="Lines / devices / procedures" value={p.devices} onChange={t("devices")} />
          </Panel>

          <Panel id="problems" title="Problem List" subtitle="Problem → Current status → Current treatment → Next action">
            {p.problems.map((x) => (
              <div key={x.id} className="grid gap-2 rounded-sm border p-3 sm:grid-cols-4">
                <TextField label="Problem" value={x.problem} onChange={(v) => probs.update(x.id, { problem: v })} />
                <TextField label="Status" value={x.status} onChange={(v) => probs.update(x.id, { status: v })} />
                <TextField label="Treatment" value={x.treatment} onChange={(v) => probs.update(x.id, { treatment: v })} />
                <TextField label="Next action" value={x.next} onChange={(v) => probs.update(x.id, { next: v })} />
                <button className="text-left text-xs text-destructive sm:col-span-4" onClick={() => probs.remove(x.id)}>Remove</button>
              </div>
            ))}
            <button className="btn btn-outline" onClick={() => probs.add({ id: uid(), problem: "", status: "", treatment: "", next: "" })}>+ Add problem</button>
          </Panel>

          <Panel id="pending" title="Pending Tasks & Results" subtitle="Stays visible after the patient leaves HDW until marked done.">
            {p.pending.map((x) => (
              <div key={x.id} className={`grid gap-2 rounded-sm border p-3 sm:grid-cols-5 ${x.done ? "opacity-50" : ""}`}>
                <TextField label="Task / investigation" value={x.task} onChange={(v) => pend.update(x.id, { task: v })} />
                <TextField label="Status" value={x.status} onChange={(v) => pend.update(x.id, { status: v })} />
                <TextField label="Required action" value={x.action} onChange={(v) => pend.update(x.id, { action: v })} />
                <TextField label="Responsible" value={x.responsible} onChange={(v) => pend.update(x.id, { responsible: v })} />
                <TextField label="Timing" value={x.timing} onChange={(v) => pend.update(x.id, { timing: v })} />
                <div className="flex gap-4 text-xs sm:col-span-5">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={x.done} onChange={(e) => pend.update(x.id, { done: e.target.checked })} /> Done</label>
                  <button className="text-destructive" onClick={() => pend.remove(x.id)}>Remove</button>
                </div>
              </div>
            ))}
            <button className="btn btn-outline" onClick={() => pend.add({ id: uid(), task: "", status: "", action: "", responsible: "", timing: "", done: false })}>+ Add pending item</button>
          </Panel>

          <Panel id="meds" title="Medication Reconciliation">
            {p.meds.map((x) => (
              <div key={x.id} className="grid gap-2 rounded-sm border p-3 sm:grid-cols-6">
                <TextField className="sm:col-span-2" label="Medication" value={x.name} onChange={(v) => meds.update(x.id, { name: v })} />
                <TextField label="Dose" value={x.dose} onChange={(v) => meds.update(x.id, { dose: v })} />
                <TextField label="Route" value={x.route} onChange={(v) => meds.update(x.id, { route: v })} />
                <TextField label="Frequency" value={x.freq} onChange={(v) => meds.update(x.id, { freq: v })} />
                <SelectField label="Status" value={x.status} options={["Continue", "Stop", "Changed", "New", "Temporary"]} onChange={(v) => meds.update(x.id, { status: v as MedStatus })} />
                <TextField className="sm:col-span-5" label="Note (indication, duration, review date, change reason)" value={x.note} onChange={(v) => meds.update(x.id, { note: v })} />
                <button className="self-end text-left text-xs text-destructive" onClick={() => meds.remove(x.id)}>Remove</button>
              </div>
            ))}
            <button className="btn btn-outline" onClick={() => meds.add({ id: uid(), name: "", dose: "", route: "", freq: "", status: "Continue", note: "" })}>+ Add medication</button>
          </Panel>

          <Panel id="readiness" title="Transition Readiness" subtitle="Track each departure pathway independently.">
            {(["transfer", "discharge"] as const).map((path) => (
              <div key={path} className="space-y-2 rounded-sm border p-3">
                <p className="label-caps text-primary">{path === "transfer" ? "Transfer" : "Home discharge"}</p>
                <SelectField label="Workflow state" value={p[path].readiness} options={READINESS} onChange={(v) => setReadiness(path, (v || "Not Ready") as Patient["transfer"]["readiness"])} />
                <div className="flex flex-wrap gap-2">
                  {BLOCKERS.map((b) => {
                    const on = p[path].blockers.includes(b);
                    return <button key={b} type="button" onClick={() => toggleBlocker(path, b)}
                      className={`rounded-sm border px-2 py-1 text-xs font-semibold ${on ? "border-warning bg-warning text-foreground" : "bg-card"}`}>{b}</button>;
                  })}
                </div>
              </div>
            ))}
          </Panel>

          <Panel id="referral" title="Referrals" subtitle="Why am I referring this patient and what do I need from the receiving service? Add one referral per service.">
            {p.referrals.map((r, i) => (
              <div key={r.id} className="space-y-3 rounded-sm border p-3">
                <div className="flex items-center justify-between">
                  <p className="label-caps text-primary">Referral {i + 1}{r.service ? ` — ${r.service}` : ""}</p>
                  {(() => {
                    const doc = p.docs.referrals?.[r.id];
                    const locked = !!doc && (doc.status === "Verified" || doc.status === "Final" || !!doc.history?.length);
                    return <button className="text-xs text-destructive" disabled={locked} title={locked ? "This referral has a verified or final document version." : undefined} onClick={() => {
                      updatePatient(id, (q) => {
                        const referralDocs = { ...q.docs.referrals };
                        delete referralDocs[r.id];
                        return { ...q, referrals: q.referrals.filter((x) => x.id !== r.id), docs: { ...q.docs, referrals: referralDocs } };
                      });
                    }}>Remove</button>;
                  })()}
                </div>
                <Grid>
                  <TextField label="Service referred to" value={r.service} onChange={ref(r.id, "service")} />
                  <SelectField label="Urgency" value={r.urgency} options={["Routine", "Urgent", "Emergency"]} onChange={ref(r.id, "urgency")} />
                </Grid>
                <TextField multiline label="Reason for referral" value={r.reason} onChange={ref(r.id, "reason")} />
                <TextField multiline label="Specific clinical question" value={r.question} onChange={ref(r.id, "question")} />
                <TextField multiline label="Relevant clinical findings" value={r.findings} onChange={ref(r.id, "findings")} />
                <TextField multiline label="Treatment already given" value={r.treatmentTried} onChange={ref(r.id, "treatmentTried")} />
                <TextField multiline label="Requested action / opinion" value={r.request} onChange={ref(r.id, "request")} />
                <Grid>
                  <TextField label="Referring clinician" value={r.clinician} onChange={ref(r.id, "clinician")} />
                  <TextField label="Contact (ext / phone)" value={r.contact} onChange={ref(r.id, "contact")} />
                </Grid>
                <TextField label="Referral outcome" value={r.outcome} onChange={ref(r.id, "outcome")} />
                <fieldset className="space-y-2 rounded-sm border p-3">
                  <legend className="px-1 text-sm font-semibold">Include relevant shared-record sections</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {REFERRAL_SECTIONS.map((section) => {
                      const label: Record<(typeof REFERRAL_SECTIONS)[number], string> = { diagnoses: "Main diagnoses", comorbidities: "Comorbidities", history: "Presenting history", currentCondition: "Current condition", findings: "Referral findings", investigations: "Investigations", medications: "Current medications", devices: "Devices / support", treatment: "Treatment given" };
                      const checked = r.include.includes(section);
                      return <label key={section} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={checked} onChange={() => set("referrals", p.referrals.map((x) => x.id === r.id ? { ...x, include: checked ? x.include.filter((s) => s !== section) : [...x.include, section] } : x))} />{label[section]}</label>;
                    })}
                  </div>
                </fieldset>
                {r.include.includes("investigations") && <fieldset className="space-y-2 rounded-sm border p-3">
                  <legend className="px-1 text-sm font-semibold">Select relevant investigations</legend>
                  {p.investigations.length ? p.investigations.map((item) => <label key={item.id} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={r.investigationIds.includes(item.id)} onChange={() => updatePatient(id, (q) => ({ ...q, referrals: q.referrals.map((x) => x.id !== r.id ? x : { ...x, investigationIds: x.investigationIds.includes(item.id) ? x.investigationIds.filter((xid) => xid !== item.id) : [...x.investigationIds, item.id] }) }))} />
                    <span>{item.date || "Date not recorded"} · {item.details || "Investigation details not recorded"}</span>
                  </label>) : <p className="text-sm text-muted-foreground">Add investigations in the Relevant Investigations section first.</p>}
                </fieldset>}
              </div>
            ))}
            <button className="btn btn-outline" onClick={addReferral}>+ Add referral to another service</button>
          </Panel>

          <Panel id="transfer" title="Transfer-specific" subtitle="What does the receiving team need to know and do next?">
            <Grid>
              <TextField label="Destination" value={p.transfer.destination} onChange={sub("transfer", "destination")} />
              <TextField label="Transfer date/time" type="datetime-local" value={p.transfer.datetime} onChange={sub("transfer", "datetime")} />
              <TextField label="Oxygen requirement" value={p.transfer.oxygen} onChange={sub("transfer", "oxygen")} />
              <TextField label="Monitoring" value={p.transfer.monitoring} onChange={sub("transfer", "monitoring")} />
              <TextField label="Nursing requirement" value={p.transfer.nursing} onChange={sub("transfer", "nursing")} />
              <TextField label="Mobility" value={p.transfer.mobility} onChange={sub("transfer", "mobility")} />
              <TextField label="Nutrition" value={p.transfer.nutrition} onChange={sub("transfer", "nutrition")} />
              <TextField label="Isolation" value={p.transfer.isolation} onChange={sub("transfer", "isolation")} />
              <TextField label="Responsible service" value={p.transfer.responsible} onChange={sub("transfer", "responsible")} />
            </Grid>
            <TextField multiline label="Escalation instructions" value={p.transfer.escalation} onChange={sub("transfer", "escalation")} />
              <TextField label="Handover acknowledged by" value={p.transfer.handover} onChange={sub("transfer", "handover")} />
          </Panel>

          <Panel id="discharge" title="Discharge-home-specific">
            <Grid>
              <TextField label="Discharge date" type="date" value={p.discharge.date} onChange={sub("discharge", "date")} />
              <TextField label="Medical certificate" value={p.discharge.mc} onChange={sub("discharge", "mc")} />
            </Grid>
            <TextField multiline label="Condition at discharge" value={p.discharge.condition} onChange={sub("discharge", "condition")} />
            <TextField multiline label="Follow-up (clinic, specialty, date)" value={p.discharge.followUp} onChange={sub("discharge", "followUp")} />
            <TextField multiline label="Repeat investigations" value={p.discharge.repeatInv} onChange={sub("discharge", "repeatInv")} />
            <TextField multiline label="Wound / device care" value={p.discharge.woundCare} onChange={sub("discharge", "woundCare")} />
            <TextField multiline label="Rehabilitation" value={p.discharge.rehab} onChange={sub("discharge", "rehab")} />
            <p className="label-caps pt-2 text-primary">For the patient / caregiver (plain language)</p>
            <TextField multiline label="What happened during your stay" value={p.discharge.patientSummary} onChange={sub("discharge", "patientSummary")} />
            <TextField multiline label="Instructions (medicines, diet, activity)" value={p.discharge.instructions} onChange={sub("discharge", "instructions")} />
            <TextField multiline label="Warning symptoms — when to seek urgent help" value={p.discharge.warnings} onChange={sub("discharge", "warnings")} />
          </Panel>

          <div className="flex justify-end">
            <button className="text-sm text-destructive underline" onClick={() => {
              if (confirm("Delete this patient record permanently from this device? This cannot be undone.")) { deletePatient(id); nav({ to: "/" }); }
            }}>Delete record</button>
          </div>
        </div>
      </div>
    </main>
  );
}
