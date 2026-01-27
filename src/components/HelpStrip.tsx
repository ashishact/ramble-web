/**
 * HelpStrip - Thin help bar at the bottom of the screen
 *
 * Shows contextual help based on what the user is hovering over.
 * Any element with a `data-doc` attribute will trigger help display on hover.
 *
 * ## Usage Examples
 *
 * Simple text (no icon):
 *   <button data-doc="Click to submit the form">Submit</button>
 *
 * With icon and title:
 *   <button data-doc='{"icon":"mdi:play","title":"Play","desc":"Start playback"}'>
 *
 * Just icon and description:
 *   <input data-doc='{"icon":"mdi:magnify","desc":"Search for items"}' />
 *
 * With HTML formatting:
 *   <div data-doc='{"html":"Press <kbd>Enter</kbd> to confirm"}'>
 *
 * Common icon examples (browse more at https://icon-sets.iconify.design/):
 *   - mdi:play, mdi:pause, mdi:stop, mdi:skip-next, mdi:skip-previous
 *   - mdi:microphone, mdi:volume-high, mdi:account-voice
 *   - mdi:cog, mdi:translate, mdi:help-circle-outline
 *   - mdi:content-save, mdi:delete, mdi:pencil, mdi:plus
 *   - lucide:settings, lucide:search, lucide:user
 *   - ph:microphone, ph:speaker-high
 *
 * Programmatic usage (from JS):
 *   window.dispatchEvent(new CustomEvent('doc:show', {
 *     detail: { icon: 'mdi:info', title: 'Info', desc: 'Description here' }
 *   }));
 *   window.dispatchEvent(new CustomEvent('doc:clear'));
 */

import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';

interface DocInfo {
  icon?: string;  // Iconify icon name, e.g., "mdi:play", "lucide:mic"
  title?: string;
  desc?: string;
  html?: string;
}

export function HelpStrip() {
  const [docInfo, setDocInfo] = useState<DocInfo | null>(null);

  useEffect(() => {
    // Global mouseover listener to detect data-doc attributes
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      // Walk up the DOM to find the nearest element with data-doc
      // Limit to 10 levels to avoid performance issues
      const MAX_DEPTH = 10;
      let el: HTMLElement | null = target;
      let depth = 0;

      while (el && depth < MAX_DEPTH) {
        const docAttr = el.getAttribute('data-doc');
        if (docAttr) {
          try {
            // Try parsing as JSON first
            const parsed = JSON.parse(docAttr);
            setDocInfo(parsed);
          } catch {
            // If not JSON, treat as simple description
            setDocInfo({ desc: docAttr });
          }
          return;
        }
        el = el.parentElement;
        depth++;
      }

      // No data-doc found, clear the help
      setDocInfo(null);
    };

    document.addEventListener('mouseover', handleMouseOver);
    return () => document.removeEventListener('mouseover', handleMouseOver);
  }, []);

  // Also listen for custom events (for programmatic help)
  useEffect(() => {
    const handleDocEvent = (e: CustomEvent<DocInfo | string>) => {
      if (typeof e.detail === 'string') {
        setDocInfo({ desc: e.detail });
      } else {
        setDocInfo(e.detail);
      }
    };

    const handleDocClear = () => setDocInfo(null);

    window.addEventListener('doc:show', handleDocEvent as EventListener);
    window.addEventListener('doc:clear', handleDocClear);

    return () => {
      window.removeEventListener('doc:show', handleDocEvent as EventListener);
      window.removeEventListener('doc:clear', handleDocClear);
    };
  }, []);

  return (
    <div className="h-6 bg-base-200 border-t border-base-300 flex items-center px-3 gap-2 flex-shrink-0">
      {docInfo ? (
        <>
          {docInfo.icon && (
            <Icon icon={docInfo.icon} className="w-3 h-3 text-primary opacity-70" />
          )}
          {docInfo.title && (
            <span className="text-xs font-medium text-base-content">{docInfo.title}</span>
          )}
          {docInfo.title && docInfo.desc && (
            <span className="text-base-content/30">—</span>
          )}
          {docInfo.desc && (
            <span className="text-xs text-base-content/70">{docInfo.desc}</span>
          )}
          {docInfo.html && (
            <span
              className="text-xs text-base-content/70"
              dangerouslySetInnerHTML={{ __html: docInfo.html }}
            />
          )}
        </>
      ) : (
        <span className="text-xs text-base-content/40 flex items-center gap-1.5">
          <Icon icon="mdi:help-circle-outline" className="w-3 h-3" />
          Hover over elements for help
        </span>
      )}
    </div>
  );
}
