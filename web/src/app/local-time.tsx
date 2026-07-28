"use client";

import { useEffect, useState } from "react";

// SQLite datetime('now') stores UTC without a zone marker; rendered raw it
// reads as the wrong time of day. This renders it in the viewer's zone.
// (Client-only after mount to avoid SSR/client hydration mismatch.)
export default function LocalTime({ utc }: { utc: string }) {
  const [text, setText] = useState(utc);
  useEffect(() => {
    const d = new Date(utc.includes("T") ? utc : utc.replace(" ", "T") + "Z");
    if (!isNaN(d.getTime()))
      setText(d.toLocaleString("sv-SE", { hour12: false }).slice(0, 16));
  }, [utc]);
  return <>{text}</>;
}
