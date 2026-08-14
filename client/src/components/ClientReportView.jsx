import StatCard from './StatCard.jsx';
import ReportBreakdown from './ReportBreakdown.jsx';
import ReportTagList from './ReportTagList.jsx';
import Card from './ui/Card.jsx';
import { deriveReportSections, formatCount } from '../lib/reportDerive.js';

// Presentational render of a shaped client report (shapeReportForClient output). Used by BOTH the
// admin builder Preview and the client portal detail page so they're guaranteed identical. Every
// number, label, color, and SECTION ORDER comes from deriveReportSections (lib/reportDerive) — the
// same source the PDF export consumes — so the on-screen report and the downloaded PDF never drift.
// Section order: Activity at a glance → Voter contact breakdown → headline Support → other survey
// questions → Canvasser observations. The map is rendered separately by the parent (own data fetch).

function SectionHeading({ children }) {
  return (
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">{children}</h2>
  );
}

// Map a derived KPI to StatCard props: a positive period delta becomes an "up" pill, the rate card
// shows its static hint, and a zero-delta week shows the terse "no change" hint.
function kpiProps(k) {
  if (k.delta === null) return { hint: k.hint };
  if (k.delta > 0) return { delta: `+${formatCount(k.delta)} this week`, deltaTone: 'up' };
  return { hint: k.deltaZeroText };
}

export default function ClientReportView({ report }) {
  const { kpis, goal, contact, support, tags, others, isQuietWeek } = deriveReportSections(report);

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading>Activity at a glance</SectionHeading>
        {isQuietWeek && (
          <Card className="mb-3 bg-info-tint p-3 text-sm text-info-fg">
            A quieter week — no new doors were knocked in this period. The numbers below are cumulative
            totals to date.
          </Card>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k) => (
            <StatCard key={k.key} label={k.label} value={k.value} accent={k.accent} help={k.help} prominent {...kpiProps(k)} />
          ))}
        </div>
      </section>

      {/* Door goal, when the operator opted in. Right under the headline numbers because it
          frames them: it answers "is that a lot?" before the breakdowns start slicing it up.
          Progress only — no pace, no verdict (see ClientReport.goalSnapshot). */}
      {goal && (
        <section>
          <SectionHeading>{goal.title}</SectionHeading>
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm text-fg-muted">{goal.subtitle}</span>
              <span className="text-sm font-semibold tabular-nums text-fg">{goal.percent}%</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-fg">
                {formatCount(goal.done)}
              </span>
              <span className="text-sm text-fg-muted">of {formatCount(goal.target)} doors</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full bg-brand-600"
                style={{ width: `${goal.percent}%` }}
              />
            </div>
            {goal.remaining > 0 && (
              <p className="mt-2 text-xs text-fg-muted">
                {formatCount(goal.remaining)} doors to go.
              </p>
            )}
          </Card>
        </section>
      )}

      {/* Voter contact breakdown always reads first — right after the headline numbers and before
          the support question — so the client sees outcomes-across-all-doors up front. */}
      <section>
        <ReportBreakdown
          title={contact.title}
          subtitle={contact.subtitle}
          help={contact.help}
          items={contact.items}
          variant="segmented"
        />
      </section>

      {support && (
        <section>
          <ReportBreakdown
            title={support.title}
            subtitle={support.subtitle}
            items={support.items}
            variant="segmented"
            emphasis
          />
        </section>
      )}

      {/* Voter groups (opt-in tags) sit right after Support: the supporter universe in people,
          where the section above it is answers. Old reports carry no tags → renders nothing. */}
      {tags && (
        <section>
          <ReportTagList title={tags.title} subtitle={tags.subtitle} help={tags.help} items={tags.items} />
        </section>
      )}

      {others.length > 0 && (
        <section className="grid gap-4 lg:grid-cols-2">
          {others.map((b) => (
            <ReportBreakdown key={b.questionKey} title={b.title} items={b.items} />
          ))}
        </section>
      )}

      {report.observations?.length > 0 && (
        <section>
          <SectionHeading>Canvasser observations</SectionHeading>
          <Card className="divide-y divide-border p-0">
            {report.observations.map((s, i) => (
              <div key={i} className="p-5">
                <div className="text-base font-semibold text-fg">{s.heading}</div>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-fg-muted">
                  {s.body}
                </p>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
