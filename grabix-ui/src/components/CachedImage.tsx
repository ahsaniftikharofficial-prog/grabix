import { useEffect, useState, type CSSProperties, type ImgHTMLAttributes, type ReactEventHandler } from "react";
import { cacheMediaFromUrl, getCachedMediaObjectUrl } from "../lib/mediaCache";

const warmedImageSources = new Set<string>();
const WARMED_IMAGE_SOURCES_MAX = 4000;

function markImageSourceWarmed(src: string) {
  if (!src) return;
  if (warmedImageSources.has(src)) {
    warmedImageSources.delete(src);
  }
  warmedImageSources.add(src);
  while (warmedImageSources.size > WARMED_IMAGE_SOURCES_MAX) {
    const oldest = warmedImageSources.keys().next().value as string | undefined;
    if (!oldest) break;
    warmedImageSources.delete(oldest);
  }
}

interface CachedImageProps {
  src: string;
  alt: string;
  fallbackSrc?: string;
  style?: CSSProperties;
  className?: string;
  loading?: "eager" | "lazy";
  decoding?: "sync" | "async" | "auto";
  referrerPolicy?: ImgHTMLAttributes<HTMLImageElement>["referrerPolicy"];
  onError?: ReactEventHandler<HTMLImageElement>;
  onLoad?: ReactEventHandler<HTMLImageElement>;
}

export default function CachedImage({
  src,
  alt,
  fallbackSrc,
  style,
  className,
  loading = "lazy",
  decoding = "async",
  referrerPolicy,
  onError,
  onLoad,
}: CachedImageProps) {
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrlToRevoke = "";
    setResolvedSrc(src);

    const resolve = async () => {
      if (!src) return;
      try {
        const cachedUrl = await getCachedMediaObjectUrl(src);
        if (cancelled) {
          if (cachedUrl?.startsWith("blob:")) URL.revokeObjectURL(cachedUrl);
          return;
        }
        if (cachedUrl) {
          objectUrlToRevoke = cachedUrl.startsWith("blob:") ? cachedUrl : "";
          setResolvedSrc(cachedUrl);
          return;
        }
      } catch {
        if (!cancelled) {
          setResolvedSrc(src);
        }
      }
    };

    void resolve();

    return () => {
      cancelled = true;
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke);
      }
    };
  }, [src]);

  return (
    <img
      src={resolvedSrc || fallbackSrc || src}
      alt={alt}
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transition: "opacity 0.2s ease",
      }}
      className={className}
      loading={loading}
      decoding={decoding}
      referrerPolicy={referrerPolicy}
      onLoad={(event) => {
        setVisible(true);
        if (src && resolvedSrc === src && !warmedImageSources.has(src)) {
          markImageSourceWarmed(src);
          void cacheMediaFromUrl(src).catch(() => {
            warmedImageSources.delete(src);
          });
        }
        onLoad?.(event);
      }}
      onError={(event) => {
        setVisible(true);
        if (fallbackSrc && (event.target as HTMLImageElement).src !== fallbackSrc) {
          (event.target as HTMLImageElement).src = fallbackSrc;
        }
        onError?.(event);
      }}
    />
  );
}
