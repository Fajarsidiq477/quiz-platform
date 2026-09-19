"use client";

import { useSyncExternalStore } from "react";
import { formatLocal } from "./date-utils";

const subscribe = () => () => {};

/**
 * Shows an instant in the viewer's time zone. The server does not know that zone, so it renders
 * nothing and the browser fills the text in after hydration (no server/client mismatch).
 */
export function LocalDateTime({ iso, fallback = "—" }: { iso: string | null; fallback?: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatLocal(iso),
    () => "",
  );
  if (!iso) return <>{fallback}</>;
  return <time dateTime={iso}>{text}</time>;
}
