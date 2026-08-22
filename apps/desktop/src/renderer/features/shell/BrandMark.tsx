import type { ReactElement } from 'react';

export function BrandMark(): ReactElement {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" role="presentation">
        <path d="M5 19V5h3.2l7.6 8.6V5H19v14h-3.2L8.2 10.5V19H5Z" fill="currentColor" />
      </svg>
    </span>
  );
}
