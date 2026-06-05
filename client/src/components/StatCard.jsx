export default function StatCard({ label, value, hint, accent }) {
  const accentClass =
    accent === 'green'
      ? 'text-green-700 dark:text-green-400'
      : accent === 'red'
      ? 'text-red-700 dark:text-red-400'
      : accent === 'amber'
      ? 'text-amber-700 dark:text-amber-400'
      : accent === 'blue'
      ? 'text-blue-700 dark:text-blue-400'
      : accent === 'brand'
      ? 'text-brand-700 dark:text-brand-400'
      : 'text-gray-900 dark:text-gray-100';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accentClass}`}>
        {value ?? '—'}
      </div>
      {hint && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</div>}
    </div>
  );
}
