export function BetaBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-surface2 border border-brass rounded-full">
      <span className="w-1.5 h-1.5 bg-brass rounded-full animate-pulse"></span>
      <span className="text-xs font-mono font-semibold text-brass tracking-wide uppercase">Beta</span>
    </span>
  );
}

export function VersionBadge() {
  const version = "0.1.0-beta.1";
  return (
    <span className="text-xs font-mono text-faint hover:text-muted transition-colors cursor-help" title={`Version ${version}`}>
      {version}
    </span>
  );
}
