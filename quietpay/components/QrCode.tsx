"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

type Props = { value: string; size?: number; label?: string };

export function QrCode({ value, size = 220, label = "QR code" }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: size })
      .then((url) => {
        if (!cancelled) {
          setSrc(url);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (failed) return <p className="notice notice--warning" role="alert">Could not draw the QR code. Use the address text instead.</p>;
  if (!src) return <div className="qr-placeholder skeleton" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="qr" src={src} alt={label} width={size} height={size} />;
}
