"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Adding now happens in a sheet on the Spending tab; old links land there. */
export default function NewPersonalExpenseRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/personal?add=1"); }, [router]);
  return null;
}
