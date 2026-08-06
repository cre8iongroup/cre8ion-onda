import type { ReactNode } from 'react'

/** Controls-free shell for OBS / switcher capture — no panel chrome. */
export default function OutputGroupLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
