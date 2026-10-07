import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { addPatient, useDB } from "@/lib/hdw/store";
import type { Readiness } from "@/lib/hdw/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Patients — HDW CONNECT" },
      { name: "description", content: "HDW patient list with transition readiness, blockers and pending tasks." },
      { property: "og:title", content: "Patients — HDW CONNECT" },
      { property: "og:description", content: "HDW patient list with transition readiness, blockers and pending tasks." },
    ],
  }),
  component: Index,
});

function readinessClass(state: Readiness) {
  if (["Clinically Ready", "Documentation Ready", "Destination Confirmed", "Ready to Transfer/Discharge", "Departed", "Handover Completed"].includes(state)) return "border-success/40 text-success";
  if (state === "Preparing") return "border-warning bg-warning/15 text-foreground";
  return "border-border text-muted-foreground";
}

function Index() {
  const { ready, patients, storageError } = useDB();
  const nav = useNavigate();
  const create = () => {
    const id = addPatient();
    if (id) nav({ to: "/patients/$id", params: { id } });
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <section className="mb-7 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="label-caps">High Dependency Ward · Acute Internal Medicine</p>
          <h1 className="mt-1 text-3xl font-bold text-primary">Patient records</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Manage one shared clinical record and prepare focused referrals, transfers, and home discharge documents.</p>
        </div>
        <button className="btn min-h-11" disabled={!!storageError} onClick={create}>+ Add patient</button>
      </section>

      <section aria-labelledby="patient-list-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="patient-list-heading" className="text-xl font-semibold text-primary">Patients</h2>
          <span className="text-xs text-muted-foreground">{patients.length} {patients.length === 1 ? "record" : "records"} · local to this device</span>
        </div>

        {!ready && <div className="panel p-6 text-sm text-muted-foreground">Loading patient records…</div>}
        {ready && patients.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="font-serif text-lg font-semibold text-primary">No patient records yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add a record to begin preparing a referral, transfer, or discharge document.</p>
            <button className="btn mt-4" disabled={!!storageError} onClick={create}>+ Add patient</button>
          </div>
        )}

        {patients.length > 0 && <div className="panel overflow-hidden">
          {patients.map((p, index) => {
            const openTasks = p.pending.filter((task) => !task.done).length;
            const identifiers = [p.mrn, p.bed, p.age && `${p.age} y`, p.sex].filter(Boolean).join(" · ");
            const hdwDate = p.hdwAdmissionDate ? new Date(`${p.hdwAdmissionDate}T12:00:00`).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "Not recorded";
            return (
              <article key={p.id} className={`grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(230px,1.5fr)_minmax(120px,.7fr)_minmax(230px,1.15fr)_auto] lg:items-center ${index ? "border-t" : ""}`}>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold">{p.name || "Unnamed patient"}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{identifiers || "Identifiers not recorded"}</p>
                  <p className="mt-2 text-sm">{p.primaryDx || <em className="text-muted-foreground">Main diagnosis not recorded</em>}</p>
                  <p className={`mt-1.5 text-xs font-semibold ${p.allergies ? "text-destructive" : "text-warning"}`}>
                    {p.allergies ? `ALLERGY: ${p.allergies}` : "Allergy status not recorded"}
                  </p>
                </div>

                <div>
                  <span className="label-caps">HDW admission</span>
                  <p className="mt-1 text-sm">{hdwDate}</p>
                </div>

                <div>
                  <span className="label-caps">Transition readiness</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className={`inline-flex rounded-sm border px-2 py-1 text-[11px] font-semibold ${readinessClass(p.transfer.readiness)}`}>Transfer · {p.transfer.readiness}</span>
                    <span className={`inline-flex rounded-sm border px-2 py-1 text-[11px] font-semibold ${readinessClass(p.discharge.readiness)}`}>Home · {p.discharge.readiness}</span>
                  </div>
                  {(p.transfer.blockers.length > 0 || p.discharge.blockers.length > 0 || openTasks > 0) && <p className="mt-1.5 text-xs text-muted-foreground">
                    {[...p.transfer.blockers.map((blocker) => `Transfer: ${blocker}`), ...p.discharge.blockers.map((blocker) => `Home: ${blocker}`), ...(openTasks ? [`${openTasks} pending ${openTasks === 1 ? "task" : "tasks"}`] : [])].join(" · ")}
                  </p>}
                </div>

                <Link to="/patients/$id" params={{ id: p.id }} className="btn btn-outline w-fit lg:justify-self-end">Open record <span aria-hidden="true">→</span></Link>
              </article>
            );
          })}
        </div>}
      </section>

      <p className="mt-4 text-xs text-muted-foreground">Records are stored in this browser on this device and are not synchronised. Use synthetic or de-identified data during testing. Back up regularly from About &amp; Backup.</p>
    </main>
  );
}
