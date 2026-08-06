import type { Metadata } from 'next'
import LayoutsDashboard from './LayoutsDashboard'

export const metadata: Metadata = {
  title: 'Output Presets — Admin',
  description: 'Manage output window presets for the Output Builder',
}

export default function AdminLayoutsPage() {
  return <LayoutsDashboard />
}
