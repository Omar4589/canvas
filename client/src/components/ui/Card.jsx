// Resting surface: soft elevation in light, border+raised separation in dark.
export default function Card({ as: Tag = 'div', className = '', children, ...rest }) {
  return (
    <Tag
      className={`rounded-card border border-border bg-card shadow-card ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
