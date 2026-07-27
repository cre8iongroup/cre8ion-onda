import { NextRequest, NextResponse } from 'next/server'
import { handleWorkspaceRecallWebhook } from '@/lib/recall/workspaceWebhook'

/**
 * POST /api/recall/webhook
 *
 * Workspace-level Recall → Svix endpoint (dashboard-registered URL).
 * Distinct from `/api/webhook/[sessionId]` (Electron per-session forwarder).
 *
 * Auth: Svix signatures only (`RECALL_SVIX_SIGNING_SECRET`).
 * Does NOT accept `x-recall-secret` — that is Electron-forwarder-only.
 *
 * sdk_upload.complete → recordingIndex/{recordingId} → markSessionEndedFromRecall
 * (Firestore lifecycleStatus + RTDB feedState → ended), same outcome as the local forwarder.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const result = await handleWorkspaceRecallWebhook({
    rawBody,
    headers: request.headers,
    searchParams: request.nextUrl.searchParams,
  })
  return NextResponse.json(result.body, { status: result.status })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, svix-id, svix-timestamp, svix-signature',
    },
  })
}
