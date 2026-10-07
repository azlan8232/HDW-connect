import type { ReactNode } from "react";

export function TextField({ label, value, onChange, multiline, placeholder, type = "text", className = "" }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; type?: string; className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label-caps">{label}</span>
      {multiline ? (
        <textarea className="field mt-1 min-h-20" spellCheck value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="field mt-1" spellCheck type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export function SelectField({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label-caps">{label}</span>
      <select className="field mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </label>
  );
}

export function Panel({ title, subtitle, children, id }: { title: string; subtitle?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="panel p-5 scroll-mt-24">
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}
