import { notFound } from "next/navigation"
import { AdminDebugPanel } from "@/features/admin-debug/components/AdminDebugPanel"
import { isDemoDebugEnabled } from "@/lib/admin/demoDebugAccess"

export const metadata = {
  title: "Demo Ops Console — KMR Cabs",
  description: "Live trip request and booking debug feed for local demos.",
}

export default function AdminDebugPage() {
  if (!isDemoDebugEnabled()) {
    notFound()
  }

  return <AdminDebugPanel />
}
