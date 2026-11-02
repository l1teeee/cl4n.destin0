"use client";

import { useEffect, useRef, useState } from "react";

export function DrinkImage({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (ref.current?.complete) {
      setLoaded(true);
    }
  }, []);

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      ref={ref}
      className="drink-image"
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      data-loaded={loaded ? "true" : undefined}
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(true)}
    />
  );
}
