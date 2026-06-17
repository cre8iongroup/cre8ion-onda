import { redirect } from 'next/navigation'

// Root page redirects to admin panel (staff always land here)
// Attendees land directly at /session/{sessionId} via QR code
export default function HomePage() {
  redirect('/admin')
}
