import { useEffect, useState, type CSSProperties, type ImgHTMLAttributes, type ReactEventHandler } from "react";
import { cacheMediaFromUrl, getCachedMediaObjectUrl } from "../lib/mediaCache";

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
        const storedUrl = await cacheMediaFromUrl(src);
        if (cancelled) {
          if (storedUrl.startsWith("blob:")) URL.revokeObjectURL(storedUrl);
          return;
        }
        objectUrlToRevoke = storedUrl.startsWith("blob:") ? storedUrl : "";
        setResolvedSrc(storedUrl);
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
      style={style}
      className={className}
      loading={loading}
      decoding={decoding}
      referrerPolicy={referrerPolicy}
      onLoad={onLoad}
      onError={(event) => {
        if (fallbackSrc && (event.target as HTMLImageElement).src !== fallbackSrc) {
          (event.target as HTMLImageElement).src = fallbackSrc;
        }
        onError?.(event);
      }}
    />
  );
}
