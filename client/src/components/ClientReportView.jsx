import StatCard from './StatCard.jsx';
import ReportBreakdown from './ReportBreakdown.jsx';
import Card from './ui/Card.jsx';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/statusColors.js';

// Presentational render of a shaped client report (shapeReportForClient output). Used by BOTH
// the admin builder Preview and the client portal detail page so they're guaranteed identical.
// Renders the dual-window KPI cards (cumulative total + "this week" delta), the support and
// survey/contact breakdowns, and the sectioned observations. The map is rendered separately by
// the parent (it needs its own data fetch).

const CONTACT_ORDER = ['surveyed', 'not_home', 'wrong_address', 'lit_dropped'];

// Best-effort color for common support categories so the headline breakdown reads at a glance.
function supportColor(label) {
  const l = String(label).toLowerCase();
  if (l.includes('strong') && l.includes('support')) return '#16a34a';
  if (l.includes('lean') || l.includes('likely')) return '#3b82f6';
  if (l.includes('support') || l.includes('yes') || l.includes('favor')) return '#22c55e';
  if (l.includes('undecided') || l.includes('unsure') || l.includes('neutral') || l.includes('maybe'))
    return '#9ca3af';
  if (l.includes('oppos') || l.includes('against') || l.includes('no')) return '#ef4444';
  return '#6366f1';
}

const num = (n) => (n || 0).toLocaleString();
const optItems = (b) => (b?.options || []).map((o) => ({ label: o.option, count: o.count, percent: o.percent }));

export default function ClientReportView({ report }) {
  const cum = report?.stats?.cumulative || {};
  const per = report?.stats?.period || {};
  const t = cum.totals || {};
  const d = per.totals || {};

  const breakdowns = cum.surveyBreakdowns || [];
  const support =
    breakdowns.find((b) => b.questionKey === report.supportQuestionKey) ||
    breakdowns.find((b) => b.isSupportQuestion) ||
    null;
  const others = breakdowns.filter((b) => b !== support);

  const contact = cum.contactBreakdown || {};
  const contactTotal = CONTACT_ORDER.reduce((s, k) => s + (contact[k] || 0), 0);
  const contactItems = CONTACT_ORDER.map((k) => ({
    label: STATUS_LABELS[k] || k,
    count: contact[k] || 0,
    percent: contactTotal ? Math.round(((contact[k] || 0) / contactTotal) * 1000) / 10 : 0,
    color: STATUS_COLORS[k],
  }));

  const supportItems = support
    ? (support.options || []).map((o) => ({
        label: o.option,
        count: o.count,
        percent: o.percent,
        color: supportColor(o.option),
      }))
    : [];

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Activity at a glance
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Doors knocked"
            value={num(t.doorsKnocked)}
            hint={d.doorsKnocked ? `+${num(d.doorsKnocked)} this week` : 'No new doors this week'}
            accent="brand"
          />
          <StatCard
            label="Surveys taken"
            value={num(t.surveysTaken)}
            hint={d.surveysTaken ? `+${num(d.surveysTaken)} this week` : 'No new surveys this week'}
            accent="green"
          />
          <StatCard
            label="Voters surveyed"
            value={num(t.surveyedVoters)}
            hint={d.surveyedVoters ? `+${num(d.surveyedVoters)} this week` : 'No change this week'}
            accent="blue"
          />
          <StatCard
            label="Connection rate"
            value={`${t.connectionRate ?? 0}%`}
            hint="Surveys per door knocked"
            accent="amber"
          />
        </div>
      </section>

      {support && (
        <section>
          <ReportBreakdown
            title={`Support — ${support.questionLabel}`}
            subtitle={`${num(t.surveysTaken)} total responses`}
            items={supportItems}
            emphasis
          />
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <ReportBreakdown
          title="Voter contact breakdown"
          subtitle="Outcomes across all doors knocked"
          items={contactItems}
        />
        {others[0] && (
          <ReportBreakdown title={others[0].questionLabel} items={optItems(others[0])} />
        )}
      </section>

      {others.length > 1 && (
        <section className="grid gap-4 lg:grid-cols-2">
          {others.slice(1).map((b) => (
            <ReportBreakdown key={b.questionKey} title={b.questionLabel} items={optItems(b)} />
          ))}
        </section>
      )}

      {report.observations?.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Canvasser observations
          </h2>
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
