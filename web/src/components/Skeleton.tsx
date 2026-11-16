export function Bone({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-shimmer rounded bg-raised ${className}`} />;
}
