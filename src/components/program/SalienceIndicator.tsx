/**
 * Salience Indicator
 *
 * Visual indicator showing salience level with color coding.
 */

interface SalienceIndicatorProps {
  salience: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export function SalienceIndicator({
  salience,
  size = 'md',
  showLabel = false
}: SalienceIndicatorProps) {
  // Clamp salience to 0-1
  const clampedSalience = Math.max(0, Math.min(1, salience));

  // Color based on salience level
  const color = clampedSalience > 0.7
    ? 'bg-success'
    : clampedSalience > 0.4
    ? 'bg-warning'
    : 'bg-base-300';

  const heights = {
    sm: 'h-1.5',
    md: 'h-2',
    lg: 'h-3',
  };

  const widths = {
    sm: 'w-12',
    md: 'w-16',
    lg: 'w-20',
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`${widths[size]} ${heights[size]} bg-base-300 rounded-full overflow-hidden`}>
        <div
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${clampedSalience * 100}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs opacity-70">
          {Math.round(clampedSalience * 100)}%
        </span>
      )}
    </div>
  );
}
