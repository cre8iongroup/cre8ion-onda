import type { Metadata } from 'next'
import ShowsDashboard from './ShowsDashboard'

export const metadata: Metadata = {
  title: 'Shows — Admin',
  description: 'Manage events and sessions',
}

export default function AdminDashboard() {
  return <ShowsDashboard />
}
