/**
 * InlineAnnotations — Entity highlighting in conversation text
 *
 * Highlights entity names with a clean, subtle underline (text-decoration).
 * Sorts entity names longest-first to avoid partial matches.
 */

import React from 'react';

/**
 * Annotate text with entity highlights
 */
export function annotateEntities(
  text: string,
  entityNames: string[]
): React.ReactNode {
  if (!entityNames.length || !text) return text;

  // Sort longest-first to avoid partial matches
  const sorted = [...entityNames].sort((a, b) => b.length - a.length);

  // Escape special regex chars and build pattern
  const escaped = sorted.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

  // Split by pattern, keeping matched groups
  const parts = text.split(pattern);

  return parts.map((part, i) => {
    const isEntity = sorted.some(
      (name) => name.toLowerCase() === part.toLowerCase()
    );

    if (isEntity) {
      return (
        <span
          key={i}
          className="underline decoration-primary/40 decoration-1 underline-offset-2"
        >
          {part}
        </span>
      );
    }

    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

interface AnnotatedTextProps {
  text: string;
  entityNames: string[];
  className?: string;
}

export function AnnotatedText({ text, entityNames, className = '' }: AnnotatedTextProps) {
  return (
    <span className={className}>
      {annotateEntities(text, entityNames)}
    </span>
  );
}
