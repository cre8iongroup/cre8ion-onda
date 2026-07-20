import type { Metadata } from 'next'
import LayoutsDashboard from './LayoutsDashboard'

export const metadata: Metadata = {
  title: 'Layouts — Admin',
  description: 'Manage output layout templates',
}

export default function AdminLayoutsPage() {
  return <LayoutsDashboard />
}
