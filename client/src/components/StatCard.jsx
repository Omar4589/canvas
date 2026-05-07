export default function StatCard({ label, value, hint, accent }) {
  const accentClass =
    accent === 'green'
      ? 'text-green-700'
      : accent === 'red'
      ? 'text-red-700'
      : accent === 'amber'
      ? 'text-amber-700'
      : accent === 'blue'
      ? 'text-blue-700'
      : accent === 'brand'
      ? 'text-brand-700'
      : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accentClass}`}>
        {value ?? '—'}
      </div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}
