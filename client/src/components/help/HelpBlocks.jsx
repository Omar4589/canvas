import { Link } from 'react-router-dom';
import { IconInfo, IconAlert, IconCheck } from '../ui/index.js';

// Renders the Help Center BLOCK MODEL into themed elements. The server already parsed
// the markdown (services/help/markdownBlocks.js), so there is no markdown dependency here
// — this just maps blocks → JSX. Block types: heading, paragraph, list, callout, code.
// A `span` is inline text { text, bold?, italic?, code?, href? } (flags compose); an href
// without an http scheme is an internal help-article slug (→ react-router Link).

const CALLOUT = {
  tip: { box: 'border-success/30 bg-success-tint text-success-fg', Icon: IconCheck },
  warning: { box: 'border-warning/30 bg-warning-tint text-warning-fg', Icon: IconAlert },
  note: { box: 'border-info/30 bg-info-tint text-info-fg', Icon: IconInfo },
};

const LINK_CLS = 'font-medium text-brand-accent underline underline-offset-2 hover:text-brand-hover';

function InlineSpan({ span }) {
  const { text = '', bold, italic, code, href } = span;
  let cls = '';
  if (bold) cls += ' font-semibold';
  if (italic) cls += ' italic';
  cls = cls.trim();

  let node;
  if (code) {
    node = <code className={`rounded bg-sunken px-1 py-0.5 font-mono text-[0.85em] ${cls}`}>{text}</code>;
  } else if (cls) {
    node = <span className={cls}>{text}</span>;
  } else {
    node = text;
  }

  if (href) {
    if (/^https?:/i.test(href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>
          {node}
        </a>
      );
    }
    // Scheme-less href → internal help-article slug.
    return (
      <Link to={`/help/${href}`} className={LINK_CLS}>
        {node}
      </Link>
    );
  }
  return node;
}

function Spans({ spans = [] }) {
  return spans.map((s, i) => <InlineSpan key={i} span={s} />);
}

function Block({ block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = block.level === 2 ? 'h2' : 'h3';
      const cls =
        block.level === 2
          ? 'mt-2 text-lg font-semibold text-fg'
          : 'mt-1 text-base font-semibold text-fg';
      return (
        <Tag className={cls}>
          <Spans spans={block.spans} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p className="text-sm leading-relaxed text-fg-muted">
          <Spans spans={block.spans} />
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          className={`ml-5 space-y-1.5 text-sm leading-relaxed text-fg-muted marker:text-fg-subtle ${
            block.ordered ? 'list-decimal' : 'list-disc'
          }`}
        >
          {(block.items || []).map((item, i) => (
            <li key={i}>
              <Spans spans={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'callout': {
      const { box, Icon } = CALLOUT[block.variant] || CALLOUT.note;
      return (
        <div className={`flex gap-2.5 rounded-lg border px-4 py-3 text-sm leading-relaxed ${box}`}>
          <Icon size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <Spans spans={block.spans} />
          </div>
        </div>
      );
    }
    case 'code':
      return (
        <pre className="overflow-x-auto rounded-lg border border-border bg-sunken p-3 text-xs leading-relaxed text-fg">
          <code className="font-mono">{block.text}</code>
        </pre>
      );
    default:
      return null;
  }
}

export default function HelpBlocks({ blocks = [], className = '' }) {
  return (
    <div className={`space-y-4 ${className}`}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
