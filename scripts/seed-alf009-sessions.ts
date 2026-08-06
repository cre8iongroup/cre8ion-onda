/**
 * One-off seed: ALPFA Convention 2026 sessions into the existing Show.
 *
 * Resolves rooms by name against existing Room docs only — never creates Rooms
 * or a Show. Aborts if any seed room name is missing or ambiguous.
 * Does NOT write company / track / consentStatus.
 *
 * Also seeds one full-day AV test session per matched room (2026-08-07).
 *
 * Usage (dry-run — default):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID=cre8ion-onda \
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://cre8ion-onda-default-rtdb.firebaseio.com \
 *   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=cre8ion-onda.firebasestorage.app \
 *   npx tsx scripts/seed-alf009-sessions.ts
 *
 * Apply writes (after reviewing dry-run room match report):
 *   …same env… CONFIRM=1 npx tsx scripts/seed-alf009-sessions.ts
 *
 * Target project must be cre8ion-onda (not cre8ion-onda-503301).
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAdminFirestore, REQUIRED_FIREBASE_PROJECT_ID } from '../lib/firebase/admin'
import type { ShowDoc, ShowRoom } from '../types'

const SHOW_NAME = 'ALPFA Convention 2026'
const CREATED_BY = 'seed-alf009-sessions'
const DEFAULT_TZ = 'America/New_York'
const AV_TEST_DAY = '2026-08-07'
const AV_TEST_START = '00:00'
const AV_TEST_END = '23:59'

/** Match lib/rooms.ts — keep local so this admin script does not import client SDK. */
function normalizeRoomName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

function roomNameKey(name: string): string {
  return normalizeRoomName(name).toLowerCase()
}

type SeedGroup = 'visionStage' | 'exchangeStage' | 'infoSessionsAndWorkshops' | 'avTest'

interface SeedEntry {
  title: string
  day: string
  start: string
  end: string
  room: string
}

/** Source schedule — company / consentStatus / track ignored on purpose. */
const SEED = {
  show: { name: SHOW_NAME, timezone: DEFAULT_TZ },
  visionStage: [
    { title: '02 Opening Session', day: '2026-08-10', start: '09:30', end: '11:00', room: 'Crown Ballroom' },
    { title: '04 Women of ALPFA Luncheon', day: '2026-08-10', start: '12:30', end: '14:00', room: 'Crown Ballroom' },
    { title: '07 Awards Ceremony', day: '2026-08-10', start: '19:00', end: '20:30', room: 'Crown Ballroom' },
    { title: '12 Gala - Legacy by Design', day: '2026-08-11', start: '19:00', end: '21:00', room: 'Crown Ballroom' },
    { title: '15 ALPFA Scholarship Ceremony (Invite Only)', day: '2026-08-12', start: '12:00', end: '13:30', room: 'Crown Ballroom' },
  ] satisfies SeedEntry[],
  exchangeStage: [
    { title: 'Deloitte Accounting for You', day: '2026-08-09', start: '12:00', end: '15:00', room: 'Richardson A' },
    { title: '03 PP Workshop 1: Innovation at the Intersection of Science, Technology, and Human Impact', day: '2026-08-10', start: '11:30', end: '12:30', room: 'Richardson A' },
    { title: '06 Market Dynamics and Growth Engines: A forward look at U.S. Economic Growth', day: '2026-08-10', start: '15:30', end: '16:30', room: 'Richardson A' },
    { title: '09 WOA Workshop 1: the three high impact conversations that accelerate early career', day: '2026-08-11', start: '11:00', end: '12:00', room: 'Richardson A' },
    { title: '11 PP Workshop 2: harnessing disruption: turning change into enterprise strategy', day: '2026-08-11', start: '15:00', end: '16:00', room: 'Richardson A' },
    { title: '13 PwC - Powerful Perspectives', day: '2026-08-12', start: '10:00', end: '10:30', room: 'Richardson AB' },
    { title: '14 WOA Workshop 2: the power of strategic visibility and storytelling', day: '2026-08-12', start: '12:00', end: '13:00', room: 'Richardson AB' },
    { title: '16 Convention Closing Session: Elevating the Momentum. Embodying the Future.', day: '2026-08-12', start: '15:30', end: '16:30', room: 'Richardson AB' },
  ] satisfies SeedEntry[],
  infoSessionsAndWorkshops: [
    { title: 'Get to Know EY', day: '2026-08-09', start: '13:00', end: '14:00', room: 'E219A' },
    { title: 'Get to know Gusto - Building Community Through Affinity Groups', day: '2026-08-09', start: '13:00', end: '14:00', room: 'E221A' },
    { title: 'Getting to Know Amazon', day: '2026-08-09', start: '13:00', end: '14:00', room: 'E219D' },
    { title: 'Power Moves - Find the Right Team for YOU - Bank of America', day: '2026-08-09', start: '13:00', end: '14:00', room: 'E217' },
    { title: 'PwC Future Foundations: Strategies for Success Beyond College', day: '2026-08-09', start: '13:00', end: '14:00', room: 'E219BC' },
    { title: 'Welcome to the Mission: Building Careers with Purpose at USAA', day: '2026-08-09', start: '13:00', end: '14:00', room: 'E218' },
    { title: 'AI in Action: Mastering Prompts from Beginner to Advanced', day: '2026-08-09', start: '14:30', end: '15:30', room: 'E218' },
    { title: 'BDO Careers & Culture', day: '2026-08-09', start: '14:30', end: '15:30', room: 'E219BC' },
    { title: 'Building Connections That Matter', day: '2026-08-09', start: '14:30', end: '15:30', room: 'E217' },
    { title: 'Consulting, Culture, Careers: Protiviti', day: '2026-08-09', start: '14:30', end: '15:30', room: 'E221A' },
    { title: 'Get to Know Bloomberg 101', day: '2026-08-09', start: '14:30', end: '15:30', room: 'E219A' },
    { title: 'Get to know Goldman Sachs', day: '2026-08-09', start: '14:30', end: '15:30', room: 'E219D' },
    { title: 'Discover Your Personal Purpose', day: '2026-08-09', start: '16:00', end: '17:00', room: 'E218' },
    { title: 'Get to know KPMG', day: '2026-08-09', start: '16:00', end: '17:00', room: 'E219D' },
    { title: "Get to Know Moody's", day: '2026-08-09', start: '16:00', end: '17:00', room: 'E217' },
    { title: 'HSBC: Day-in-the-Life', day: '2026-08-09', start: '16:00', end: '17:00', room: 'E221A' },
    { title: 'Living the Well Life at Wells Fargo', day: '2026-08-09', start: '16:00', end: '17:00', room: 'E219A' },
    { title: 'Morgan Stanley Info Session', day: '2026-08-09', start: '16:00', end: '17:00', room: 'E219BC' },
    { title: 'Building Wealth with Purpose: Strategies, Access, and Insights Powered by Morgan Stanley', day: '2026-08-10', start: '11:30', end: '12:30', room: 'E217' },
    { title: 'Business Chemistry in Action: Strengthening Team Dynamics', day: '2026-08-10', start: '11:30', end: '12:30', room: 'W206A' },
    { title: 'Caminos Diferentes: Early Career in the Age of AI', day: '2026-08-10', start: '11:30', end: '12:30', room: 'W207BC' },
    { title: 'From Campus to Career: What Your First Job Will Actually Be Like', day: '2026-08-10', start: '11:30', end: '12:30', room: 'W208' },
    { title: 'Leading with AI: From Productivity to Business Impact', day: '2026-08-10', start: '11:30', end: '12:30', room: 'E219BC' },
    { title: 'Navigating Conflict and Difficult Conversations', day: '2026-08-10', start: '11:30', end: '12:30', room: 'E221A' },
    { title: 'Navigating Recruiting with Intention, Relationships, and Resilience', day: '2026-08-10', start: '11:30', end: '12:30', room: 'W206B' },
    { title: 'Navigating Uncertainty Through Networking: Turning Conversations into Career Opportunities', day: '2026-08-10', start: '11:30', end: '12:30', room: 'W207A' },
    { title: "Robot-Proof: The Human Skills AI Can't Touch", day: '2026-08-10', start: '11:30', end: '12:30', room: 'E219D' },
    { title: 'The Multigenerational Advantage: Building Stronger Teams for the Future', day: '2026-08-10', start: '11:30', end: '12:30', room: 'E219A' },
    { title: 'Work, reworked: What it takes to win in the age of AI', day: '2026-08-10', start: '11:30', end: '12:30', room: 'E218' },
    { title: 'Designed to Serve: How Latinos Are Reimagining Healthcare from the Inside Out', day: '2026-08-10', start: '14:00', end: '15:00', room: 'W206A' },
    { title: 'Empowerment in Action: Building the ALPFA Way Together', day: '2026-08-10', start: '14:00', end: '15:00', room: 'E218' },
    { title: 'Faster, Smarter Business Decisions with Synthetic Customers', day: '2026-08-10', start: '14:00', end: '15:00', room: 'E219BC' },
    { title: 'From Insights to Impact: Visa Consulting & Analytics', day: '2026-08-10', start: '14:00', end: '15:00', room: 'E219A' },
    { title: 'From Self-Improvement to Purposeful Impact', day: '2026-08-10', start: '14:00', end: '15:00', room: 'E221A' },
    { title: 'Keys to Financial Literacy', day: '2026-08-10', start: '14:00', end: '15:00', room: 'W208' },
    { title: 'Manos a la Obra: Citizen-Led AI for Finance & Accounting', day: '2026-08-10', start: '14:00', end: '15:00', room: 'W207BC' },
    { title: 'Mentorship & Connection', day: '2026-08-10', start: '14:00', end: '15:00', room: 'W207A' },
    { title: 'The Human Layer: How Subject-Matter Experts Make Financial AI Work', day: '2026-08-10', start: '14:00', end: '15:00', room: 'W206B' },
    { title: 'Turning Posts into Profits: Mastering Taxes as a Social Media Influencer', day: '2026-08-10', start: '14:00', end: '15:00', room: 'E219D' },
    { title: 'Wellbeing Leadership Lab: Human Skills for the Future of Work', day: '2026-08-10', start: '14:00', end: '15:00', room: 'E217' },
    { title: 'AI Career Lab: Rethink, Reskill, Reimagine Your Future of Work', day: '2026-08-10', start: '15:30', end: '16:30', room: 'W206A' },
    { title: 'AI in Cyber Defense: Managing Risk and Unlocking Advantage', day: '2026-08-10', start: '15:30', end: '16:30', room: 'E218' },
    { title: 'AY AY AI: Overcoming your Fear of AI and How to Use it to your Advantage', day: '2026-08-10', start: '15:30', end: '16:30', room: 'W208' },
    { title: 'CoPilot CoWork: When AI Stops Assisting, and Starts Doing the Work', day: '2026-08-10', start: '15:30', end: '16:30', room: 'E219BC' },
    { title: 'From Influence to Infrastructure: How Latino Leaders Build Civic Power that Lasts', day: '2026-08-10', start: '15:30', end: '16:30', room: 'E219A' },
    { title: 'Networking for Success', day: '2026-08-10', start: '15:30', end: '16:30', room: 'E217' },
    { title: 'What No One Tells You About Work: Feedback & Communication Skills That Matter', day: '2026-08-10', start: '15:30', end: '16:30', room: 'W206B' },
    { title: 'YPTC - Design Your Financial Voice: From Finance Professional to Strategic Leader', day: '2026-08-10', start: '15:30', end: '16:30', room: 'E221A' },
    { title: 'AI Unlocked: Tools, Strategies, & Real-World Examples', day: '2026-08-11', start: '11:00', end: '12:00', room: 'E221A' },
    { title: 'Fidelity Presents: 5 Money Musts', day: '2026-08-11', start: '11:00', end: '12:00', room: 'W207BC' },
    { title: 'From Classroom to Career: AI Style', day: '2026-08-11', start: '11:00', end: '12:00', room: 'W207A' },
    { title: 'From Doubt to Drive: Turning Imposter Syndrome Feelings into Fuel', day: '2026-08-11', start: '11:00', end: '12:00', room: 'E219D' },
    { title: 'Getting Practical with AI: What it Means for You, Your Work, and Your Leaders', day: '2026-08-11', start: '11:00', end: '12:00', room: 'W208' },
    { title: 'Lead From Your Identity: Building a Career in Professional Services Without Leaving Yourself Behind', day: '2026-08-11', start: '11:00', end: '12:00', room: 'E219A' },
    { title: 'Purpose, Presence and Power: A Conversation on Leading Authentically', day: '2026-08-11', start: '11:00', end: '12:00', room: 'W206B' },
    { title: 'Rethinking Career Success: How to Build a Career that Evolves with You', day: '2026-08-11', start: '11:00', end: '12:00', room: 'E219BC' },
    { title: 'The ALPFA Fund: Where Students become Investors', day: '2026-08-11', start: '11:00', end: '12:00', room: 'W206A' },
    { title: 'The CPA Journey: Real Stories', day: '2026-08-11', start: '11:00', end: '12:00', room: 'E218' },
    { title: 'Think Like an Innovator: Use AI & Design Thinking to Drive Business', day: '2026-08-11', start: '11:00', end: '12:00', room: 'E217' },
    { title: 'Belonging in the Workplace', day: '2026-08-11', start: '15:00', end: '16:00', room: 'E219BC' },
    { title: 'Beyond the Salary: How to Start Building Wealth When No One in Your Family Did', day: '2026-08-11', start: '15:00', end: '16:00', room: 'W207A' },
    { title: 'Built for This: The Road from Campus to the C-Suite', day: '2026-08-11', start: '15:00', end: '16:00', room: 'W206B' },
    { title: 'Emotional Intelligence and Leadership', day: '2026-08-11', start: '15:00', end: '16:00', room: 'E218' },
    { title: 'Everyday AI Use to Enhance Your Work', day: '2026-08-11', start: '15:00', end: '16:00', room: 'E217' },
    { title: 'From Data to Decisions: Building the Right Foundation for AI-Enabled Workflows and Workforce', day: '2026-08-11', start: '15:00', end: '16:00', room: 'E219A' },
    { title: "Smarter Prep. Faster Career. Meet Newt - Becker's AI Study Assistant", day: '2026-08-11', start: '15:00', end: '16:00', room: 'W206A' },
    { title: 'The New Rules of Success: Owning Your Wealth Future in the Age of AI', day: '2026-08-11', start: '15:00', end: '16:00', room: 'W208' },
    { title: 'Wellbeing by Design: Thriving from the Inside Out', day: '2026-08-11', start: '15:00', end: '16:00', room: 'E221A' },
    { title: 'Who Gets Through the Filter? AI, Bias, and Equity in Hiring Process', day: '2026-08-11', start: '15:00', end: '16:00', room: 'E219D' },
    { title: 'Your Voice Matters: Inclusion & Opportunity with the AICPA', day: '2026-08-11', start: '15:00', end: '16:00', room: 'W207BC' },
    { title: 'AI Leadership and Workforce Transformation', day: '2026-08-12', start: '12:00', end: '13:00', room: 'E217' },
    { title: 'Fearless Forward: EQ Leadership for the AI Era', day: '2026-08-12', start: '12:00', end: '13:00', room: 'E219BC' },
    { title: 'Fidelity Presents: 5 Money Musts', day: '2026-08-12', start: '12:00', end: '13:00', room: 'W208' },
    { title: 'From Consumer to Creator: The AI Fluency Framework for Latino Professionals Ready to Lead, Build, and Give Back', day: '2026-08-12', start: '12:00', end: '13:00', room: 'E221A' },
    { title: 'Inside Global Payments: LATAM Growth & the Power of AI', day: '2026-08-12', start: '12:00', end: '13:00', room: 'E218' },
    { title: "Lead by Design: The EQ Skills They Don't Teach You", day: '2026-08-12', start: '12:00', end: '13:00', room: 'W206B' },
    { title: 'Stay Agile, Stay Ahead | Career Development Discussion', day: '2026-08-12', start: '12:00', end: '13:00', room: 'E219A' },
    { title: 'The Game of Life - Elevate Your Financial Wellness', day: '2026-08-12', start: '12:00', end: '13:00', room: 'E219D' },
    { title: 'Thinking Styles: Understanding How You Think, Connect, and Lead', day: '2026-08-12', start: '12:00', end: '13:00', room: 'W207A' },
  ] satisfies SeedEntry[],
} as const

type RoomPlan =
  | {
      action: 'matched'
      seedName: string
      normalized: string
      roomId: string
      existingName: string
      nameDisplayDiffers: boolean
      source: string
    }
  | {
      action: 'missing'
      seedName: string
      normalized: string
    }
  | {
      action: 'ambiguous'
      seedName: string
      normalized: string
      reason: string
      candidates: Array<{ id: string; name: string; source: string }>
    }

interface SessionPlan {
  group: SeedGroup
  title: string
  roomSeedName: string
  roomId: string | null
  roomDisplayName: string
  scheduledStart: Date
  scheduledEnd: Date
}

/**
 * Convert a wall-clock date+time in an IANA zone to a UTC Date.
 * Uses Intl offset probing (no date-fns-tz dependency).
 */
function zonedDateTimeToUtc(day: string, hm: string, timeZone: string): Date {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(hm)
  if (!dayMatch || !timeMatch) {
    throw new Error(`Invalid day/time: day=${JSON.stringify(day)} time=${JSON.stringify(hm)}`)
  }
  const year = Number(dayMatch[1])
  const month = Number(dayMatch[2])
  const dayOfMonth = Number(dayMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  if (
    month < 1 ||
    month > 12 ||
    dayOfMonth < 1 ||
    dayOfMonth > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    throw new Error(`Out-of-range day/time: ${day} ${hm}`)
  }

  const utcGuess = Date.UTC(year, month - 1, dayOfMonth, hour, minute, 0)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const partsAsUtc = (ms: number) => {
    const parts = formatter.formatToParts(new Date(ms))
    const get = (type: Intl.DateTimeFormatPartTypes) => {
      const v = parts.find((p) => p.type === type)?.value
      if (!v) throw new Error(`Missing Intl part ${type} for ${timeZone}`)
      return Number(v === '24' ? '0' : v) // some engines emit hour 24
    }
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
      second: get('second'),
    }
  }

  const asUtcMs = (p: ReturnType<typeof partsAsUtc>) =>
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)

  // Desired wall time as if it were UTC, minus the zone's offset at that instant.
  let utcMs = utcGuess
  for (let i = 0; i < 3; i++) {
    const got = partsAsUtc(utcMs)
    const gotAsUtc = asUtcMs(got)
    const desiredAsUtc = Date.UTC(year, month - 1, dayOfMonth, hour, minute, 0)
    const delta = desiredAsUtc - gotAsUtc
    utcMs += delta
    if (delta === 0) break
  }

  const verify = partsAsUtc(utcMs)
  if (
    verify.year !== year ||
    verify.month !== month ||
    verify.day !== dayOfMonth ||
    verify.hour !== hour ||
    verify.minute !== minute
  ) {
    throw new Error(
      `Timezone conversion failed for ${day} ${hm} ${timeZone} → got ` +
        `${verify.year}-${String(verify.month).padStart(2, '0')}-${String(verify.day).padStart(2, '0')} ` +
        `${String(verify.hour).padStart(2, '0')}:${String(verify.minute).padStart(2, '0')}`,
    )
  }

  return new Date(utcMs)
}

function allSeedEntries(): Array<SeedEntry & { group: SeedGroup }> {
  return [
    ...SEED.visionStage.map((e) => ({ ...e, group: 'visionStage' as const })),
    ...SEED.exchangeStage.map((e) => ({ ...e, group: 'exchangeStage' as const })),
    ...SEED.infoSessionsAndWorkshops.map((e) => ({
      ...e,
      group: 'infoSessionsAndWorkshops' as const,
    })),
  ]
}

function uniqueSeedRoomNames(): string[] {
  const seen = new Map<string, string>()
  for (const entry of allSeedEntries()) {
    const key = roomNameKey(entry.room)
    if (!key) continue
    if (!seen.has(key)) seen.set(key, normalizeRoomName(entry.room))
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

async function main() {
  const confirm = process.env.CONFIRM === '1' || process.env.CONFIRM === 'true'
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || ''

  console.log(`[seed-alf009] projectId=${projectId || '(unset)'} confirm=${confirm}`)
  if (projectId && projectId !== REQUIRED_FIREBASE_PROJECT_ID) {
    throw new Error(
      `Refusing to run: NEXT_PUBLIC_FIREBASE_PROJECT_ID must be "${REQUIRED_FIREBASE_PROJECT_ID}" ` +
        `(got ${JSON.stringify(projectId)}).`,
    )
  }

  const fs = getAdminFirestore()

  // ── Resolve existing show (never create) ──────────────────────────
  const showSnap = await fs.collection('shows').where('name', '==', SHOW_NAME).get()
  if (showSnap.empty) {
    throw new Error(`No Show found with name === ${JSON.stringify(SHOW_NAME)}`)
  }
  if (showSnap.size > 1) {
    const ids = showSnap.docs.map((d) => d.id).join(', ')
    throw new Error(
      `Ambiguous Show name ${JSON.stringify(SHOW_NAME)}: ${showSnap.size} docs (${ids})`,
    )
  }

  const showDoc = showSnap.docs[0]
  const showId = showDoc.id
  const showData = showDoc.data() as ShowDoc
  const timeZone =
    typeof showData.showTimezone === 'string' && showData.showTimezone.trim()
      ? showData.showTimezone.trim()
      : SEED.show.timezone
  const languages =
    Array.isArray(showData.defaultLanguages) && showData.defaultLanguages.length > 0
      ? showData.defaultLanguages.filter((l): l is string => typeof l === 'string')
      : ['en']

  console.log(`[seed-alf009] showId=${showId} name=${JSON.stringify(showData.name)} tz=${timeZone}`)
  console.log(`[seed-alf009] languages=${JSON.stringify(languages)}`)

  // ── Load existing rooms (subcollection + denormalized catalog) ────
  const roomsSnap = await fs.collection(`shows/${showId}/rooms`).get()
  const byId = new Map<string, { id: string; name: string; source: string }>()

  for (const doc of roomsSnap.docs) {
    const name = typeof doc.data().name === 'string' ? doc.data().name : ''
    byId.set(doc.id, { id: doc.id, name, source: 'subcollection' })
  }

  const denorm = Array.isArray(showData.rooms) ? showData.rooms : []
  for (const r of denorm as ShowRoom[]) {
    if (!r?.id || typeof r.name !== 'string') continue
    const existing = byId.get(r.id)
    if (!existing) {
      byId.set(r.id, { id: r.id, name: r.name, source: 'denormalized-only' })
    } else if (existing.name !== r.name) {
      console.warn(
        `[seed-alf009] WARN room ${r.id}: subcollection name=${JSON.stringify(existing.name)} ` +
          `vs denormalized name=${JSON.stringify(r.name)} — using subcollection name`,
      )
    }
  }

  const byKey = new Map<string, Array<{ id: string; name: string; source: string }>>()
  for (const room of byId.values()) {
    const key = roomNameKey(room.name)
    if (!key) continue
    const list = byKey.get(key) ?? []
    list.push(room)
    byKey.set(key, list)
  }

  console.log(
    `[seed-alf009] existing rooms: subcollection=${roomsSnap.size} denormalized=${denorm.length} merged=${byId.size}`,
  )

  // ── Plan room resolutions (match existing only — never create) ────
  const roomPlans: RoomPlan[] = []
  for (const seedName of uniqueSeedRoomNames()) {
    const key = roomNameKey(seedName)
    const normalized = normalizeRoomName(seedName)
    const hits = byKey.get(key) ?? []

    if (hits.length > 1) {
      roomPlans.push({
        action: 'ambiguous',
        seedName,
        normalized,
        reason: `Multiple existing rooms share roomNameKey ${JSON.stringify(key)}`,
        candidates: hits.map((h) => ({ id: h.id, name: h.name, source: h.source })),
      })
      continue
    }

    if (hits.length === 1) {
      const hit = hits[0]
      roomPlans.push({
        action: 'matched',
        seedName,
        normalized,
        roomId: hit.id,
        existingName: hit.name,
        nameDisplayDiffers: hit.name !== normalized,
        source: hit.source,
      })
      continue
    }

    roomPlans.push({
      action: 'missing',
      seedName,
      normalized,
    })
  }

  // Always print the full room match report before any abort / write.
  const matched = roomPlans.filter((p): p is Extract<RoomPlan, { action: 'matched' }> => p.action === 'matched')
  const missing = roomPlans.filter((p) => p.action === 'missing')
  const ambiguous = roomPlans.filter((p) => p.action === 'ambiguous')

  console.log('\n========== ROOM MATCH REPORT ==========')
  console.log(`Seed unique rooms: ${roomPlans.length}`)
  console.log(`Matched: ${matched.length}  Missing: ${missing.length}  Ambiguous: ${ambiguous.length}`)
  console.log('--- Matched (seed name → existing Room) ---')
  for (const p of matched) {
    const note = p.nameDisplayDiffers
      ? ` ⚠ display differs: seed=${JSON.stringify(p.normalized)} stored=${JSON.stringify(p.existingName)}`
      : ''
    console.log(
      `  MATCH  seed=${JSON.stringify(p.seedName)} → id=${p.roomId} ` +
        `name=${JSON.stringify(p.existingName)} source=${p.source}${note}`,
    )
  }
  if (missing.length > 0) {
    console.log('--- Missing (no existing Room) ---')
    for (const p of missing) {
      if (p.action !== 'missing') continue
      console.log(`  MISSING seed=${JSON.stringify(p.seedName)} normalized=${JSON.stringify(p.normalized)}`)
    }
  }
  if (ambiguous.length > 0) {
    console.log('--- Ambiguous ---')
    for (const p of ambiguous) {
      if (p.action !== 'ambiguous') continue
      console.log(`  AMBIGUOUS seed=${JSON.stringify(p.seedName)} reason=${p.reason}`)
      for (const c of p.candidates) {
        console.log(`    id=${c.id} name=${JSON.stringify(c.name)} source=${c.source}`)
      }
    }
  }
  console.log('Existing rooms on show (for sanity):')
  for (const room of [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )) {
    console.log(`  id=${room.id} name=${JSON.stringify(room.name)} source=${room.source}`)
  }
  console.log('=======================================\n')

  if (missing.length > 0 || ambiguous.length > 0) {
    throw new Error(
      `Room resolution failed: missing=${missing.length} ambiguous=${ambiguous.length}. ` +
        `No writes performed. Fix room names in Firestore or seed data, then re-run.`,
    )
  }

  const roomIdBySeedKey = new Map<string, string>()
  const roomDisplayById = new Map<string, string>()
  for (const p of matched) {
    roomIdBySeedKey.set(roomNameKey(p.seedName), p.roomId)
    roomDisplayById.set(p.roomId, p.existingName)
  }

  // ── Plan schedule sessions ────────────────────────────────────────
  const sessionPlans: SessionPlan[] = []
  for (const entry of allSeedEntries()) {
    const start = zonedDateTimeToUtc(entry.day, entry.start, timeZone)
    const end = zonedDateTimeToUtc(entry.day, entry.end, timeZone)
    if (!(end > start)) {
      throw new Error(
        `Session end must be after start: ${entry.title} (${entry.day} ${entry.start}-${entry.end})`,
      )
    }
    const roomId = roomIdBySeedKey.get(roomNameKey(entry.room)) ?? null
    const roomDisplayName = roomId ? roomDisplayById.get(roomId) ?? normalizeRoomName(entry.room) : normalizeRoomName(entry.room)
    sessionPlans.push({
      group: entry.group,
      title: entry.title,
      roomSeedName: normalizeRoomName(entry.room),
      roomId,
      roomDisplayName,
      scheduledStart: start,
      scheduledEnd: end,
    })
  }

  // ── Plan one AV test session per matched room ─────────────────────
  const avStart = zonedDateTimeToUtc(AV_TEST_DAY, AV_TEST_START, timeZone)
  const avEnd = zonedDateTimeToUtc(AV_TEST_DAY, AV_TEST_END, timeZone)
  for (const p of matched) {
    const title = `${p.existingName} AV Test`
    sessionPlans.push({
      group: 'avTest',
      title,
      roomSeedName: p.normalized,
      roomId: p.roomId,
      roomDisplayName: p.existingName,
      scheduledStart: avStart,
      scheduledEnd: avEnd,
    })
  }

  const unresolved = sessionPlans.filter((s) => !s.roomId)
  if (unresolved.length > 0) {
    throw new Error(`${unresolved.length} session(s) have no resolved roomId`)
  }

  // ── Dry-run summary ───────────────────────────────────────────────
  const byGroup = {
    visionStage: sessionPlans.filter((s) => s.group === 'visionStage').length,
    exchangeStage: sessionPlans.filter((s) => s.group === 'exchangeStage').length,
    infoSessionsAndWorkshops: sessionPlans.filter((s) => s.group === 'infoSessionsAndWorkshops')
      .length,
    avTest: sessionPlans.filter((s) => s.group === 'avTest').length,
  }

  console.log('\n========== DRY-RUN SUMMARY ==========')
  console.log(`Show: ${SHOW_NAME} (${showId})`)
  console.log(`Timezone: ${timeZone}`)
  console.log(`Session languages: ${JSON.stringify(languages)}`)
  console.log(`Rooms matched: ${matched.length} (no creates)`)
  console.log(`Sessions total: ${sessionPlans.length}`)
  console.log(`  visionStage: ${byGroup.visionStage}`)
  console.log(`  exchangeStage: ${byGroup.exchangeStage}`)
  console.log(`  infoSessionsAndWorkshops: ${byGroup.infoSessionsAndWorkshops}`)
  console.log(`  avTest (${AV_TEST_DAY} ${AV_TEST_START}–${AV_TEST_END}): ${byGroup.avTest}`)
  console.log('AV test sessions:')
  for (const s of sessionPlans.filter((x) => x.group === 'avTest')) {
    console.log(
      `  ${JSON.stringify(s.title)} → roomId=${s.roomId} ` +
        `(${s.scheduledStart.toISOString()} → ${s.scheduledEnd.toISOString()})`,
    )
  }
  console.log('Session field mapping (every session):')
  console.log('  title, friendlyName(=title), roomId, scheduledStart, scheduledEnd,')
  console.log("  languages, isDraft:false, feedState:'standby', approvalState:{},")
  console.log(`  createdAt:serverTimestamp, createdBy:'${CREATED_BY}'`)
  console.log('  (company / track / consentStatus intentionally omitted)')
  console.log('  (no Room documents will be created)')
  console.log('=====================================\n')

  if (!confirm) {
    console.log(
      '[seed-alf009] Dry-run only. Re-run with CONFIRM=1 after reviewing the room match report to write.',
    )
    return
  }

  // ── Writes (sessions only) ────────────────────────────────────────
  let sessionsCreated = 0

  // Firestore batch limit 500; 92 schedule + ~14 AV tests fits in one batch.
  const batch = fs.batch()
  const sessionsCol = fs.collection(`shows/${showId}/sessions`)
  for (const s of sessionPlans) {
    if (!s.roomId) continue
    const ref = sessionsCol.doc()
    batch.set(ref, {
      title: s.title,
      friendlyName: s.title,
      roomId: s.roomId,
      scheduledStart: Timestamp.fromDate(s.scheduledStart),
      scheduledEnd: Timestamp.fromDate(s.scheduledEnd),
      languages,
      isDraft: false,
      feedState: 'standby',
      approvalState: {},
      createdAt: FieldValue.serverTimestamp(),
      createdBy: CREATED_BY,
    })
    sessionsCreated++
  }
  await batch.commit()

  console.log('\n========== WRITE RESULT ==========')
  console.log(`sessions created: ${sessionsCreated}`)
  console.log(`rooms created:    0 (match-only)`)
  console.log(`rooms matched:    ${matched.length}`)
  console.log('==================================\n')
}

main().catch((err) => {
  console.error('[seed-alf009] error:', err)
  process.exit(1)
})
