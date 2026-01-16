"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { resetAll } from "@/lib/storage";

export default function ResetPage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      await resetAll();
      router.replace("/intro");
    })();
  }, [router]);

  return <div style={{ padding: 24 }}>Resetting...</div>;
}