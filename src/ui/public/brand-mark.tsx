import type { Ref } from "react";

interface BrandMarkProps {
  className?: string;
  ref?: Ref<SVGSVGElement>;
}

export function BrandMark({ className, ref }: BrandMarkProps) {
  return (
    <svg ref={ref} className={className} viewBox="0 0 100 104" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M0 52a50 52 0 1 0 100 0a50 52 0 1 0-100 0ZM19.5 52a30.5 33.75 0 1 0 61 0a30.5 33.75 0 1 0-61 0Z"
      />
      <circle className="brand-mark-pupil" cx="50" cy="52" r="9.8" fill="currentColor" />
    </svg>
  );
}
