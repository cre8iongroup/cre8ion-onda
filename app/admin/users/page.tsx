import type { Metadata } from 'next'
import UsersDashboard from './UsersDashboard'

export const metadata: Metadata = {
  title: 'Users — Admin',
  description: 'Manage staff accounts and permissions',
}

export default function AdminUsersPage() {
  return <UsersDashboard />
}
