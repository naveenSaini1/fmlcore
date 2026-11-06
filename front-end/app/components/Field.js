export default function Field({ label, note, children }) {
  return (
    <label className="block">
      <span className="font-display text-sm font-extrabold uppercase tracking-wide">{label}</span>
      {note ? <span className="mt-0.5 block font-note text-xl leading-none text-ink/80">{note}</span> : null}
      <div className="mt-2">{children}</div>
    </label>
  );
}

export const inputClass =
  "w-full border-4 border-ink bg-white px-3 py-3 text-base outline-none placeholder:text-ink/40";
