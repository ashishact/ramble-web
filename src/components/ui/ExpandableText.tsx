/**
 * ExpandableText - Truncates long text with expand/collapse functionality
 *
 * Features:
 * - Truncates text at specified length
 * - Click anywhere on truncated text to expand
 * - "show less" link to collapse
 * - Blue "..." indicator for truncated text
 */

import { useState } from 'react';

interface ExpandableTextProps {
  /** The text content to display */
  text: string;
  /** Number of characters before truncating (default: 150) */
  truncateLength?: number;
  /** Additional className for the text */
  className?: string;
}

export function ExpandableText({
  text,
  truncateLength = 150,
  className = '',
}: ExpandableTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isLongText = text.length > truncateLength;

  if (!isLongText) {
    return <p className={`leading-relaxed ${className}`}>{text}</p>;
  }

  return (
    <div
      className={isExpanded ? '' : 'cursor-pointer'}
      onClick={!isExpanded ? () => setIsExpanded(true) : undefined}
    >
      <p className={`leading-relaxed ${className}`}>
        {isExpanded ? (
          <>
            {text}
            <button
              onClick={() => setIsExpanded(false)}
              className="text-blue-500 hover:text-blue-600 text-xs ml-1"
            >
              show less
            </button>
          </>
        ) : (
          <>
            {text.slice(0, truncateLength)}
            <span className="text-blue-500 ml-0.5">...</span>
          </>
        )}
      </p>
    </div>
  );
}
