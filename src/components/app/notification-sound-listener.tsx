"use client";

import { useEffect, useRef } from "react";

const POLL_MS = 30_000;
const SOUND_URL = "/sounds/notification.wav";

/** Plays notification.wav when unread count increases (Director / MD). */
export function NotificationSoundListener({
  role,
  initialUnread,
}: {
  role: string;
  initialUnread: number;
}) {
  const lastCount = useRef(initialUnread);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (role !== "DIRECTOR" && role !== "MD") return;

    audioRef.current = new Audio(SOUND_URL);
    audioRef.current.preload = "auto";

    const tick = async () => {
      try {
        const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
        if (!res.ok) return;
        const { count } = (await res.json()) as { count: number };
        if (count > lastCount.current) {
          const a = audioRef.current ?? new Audio(SOUND_URL);
          void a.play().catch(() => {});
        }
        lastCount.current = count;
      } catch {
        /* ignore network errors */
      }
    };

    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [role]);

  return null;
}
