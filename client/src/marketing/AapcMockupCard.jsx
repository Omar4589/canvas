// The printed AAPC ad's mockup card, rebuilt in HTML so /aapc reads as the ad's own page. Same example
// numbers as the ad, tagged "Example" because none of them is real. The ad shows three books; the
// "+ 12 more books" row is there so the pass's 41% adds up (the three alone are 59 of 156 doors).
// The ad's words are kept: "Live" (the app badges a running pass "Active", and its green "Live" dot
// is the auto-refresh switch), "Done", "Progress" and "Connection rate" (the app's own labels).
const BOOKS = [
  { name: 'Book 7', done: 17, total: 17, status: 'Done' },
  { name: 'Book 14', done: 42, total: 70, status: 'In progress' },
  { name: 'Book 8', done: 0, total: 69, status: 'Not started' },
];

const STATUS_TONE = {
  Done: 'bg-green-50 text-green-800',
  'In progress': 'bg-blue-50 text-blue-800',
  'Not started': 'bg-stone-100 text-stone-600',
};

const AapcMockupCard = () => (
  <figure className="relative mx-auto w-full max-w-md">
    <figcaption className="absolute -top-3 right-4 rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-stone-500 shadow-sm">
      Example
    </figcaption>
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_20px_60px_rgba(28,25,23,0.14)] sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[17px] font-bold text-stone-900">Beaverdale · Pass 2</p>
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700">
          <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
          Live
        </span>
      </div>
      <ul className="mt-4 grid gap-3">
        {BOOKS.map((b) => (
          <li key={b.name}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-stone-900">
                {b.name} <span className="font-normal tabular-nums text-stone-500">{b.done}/{b.total}</span>
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[b.status]}`}>{b.status}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-stone-100">
              <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${(b.done / b.total) * 100}%` }} />
            </div>
          </li>
        ))}
        <li className="text-sm text-stone-500">+ 12 more books</li>
      </ul>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-stone-50 p-3.5">
          <p className="text-2xl font-extrabold tabular-nums text-stone-900">41%</p>
          <p className="text-xs font-medium text-stone-500">Progress</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-3.5">
          <p className="text-2xl font-extrabold tabular-nums text-stone-900">24%</p>
          <p className="text-xs font-medium text-stone-500">Connection rate</p>
        </div>
      </div>
    </div>
  </figure>
);

export default AapcMockupCard;
