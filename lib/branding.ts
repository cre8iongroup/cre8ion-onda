/**
 * Branding helpers — accent sync + effective palette for attendee views.
 *
 * Accent choice (Phase 5): keep primaryColor/secondaryColor as the persisted
 * accent pair for backward compatibility; accentColors mirrors them when set.
 * Effective accents prefer accentColors when non-empty, else [primary, secondary].
 */

import type {
  EffectiveBranding,
  RoomBranding,
  RoomDoc,
  ShowBranding,
} from '@/types'

export const DEFAULT_SHOW_TIMEZONE = 'America/New_York'

export const DEFAULT_BACKGROUND_COLOR = '#0a0a0f'
export const DEFAULT_TEXT_COLOR = '#f0f0fa'
export const DEFAULT_PRIMARY_COLOR = '#5b3aee'
export const DEFAULT_SECONDARY_COLOR = '#00d4aa'

export function showAccentColors(branding: ShowBranding | null | undefined): string[] {
  const accents = branding?.accentColors?.filter(Boolean) ?? []
  if (accents.length > 0) return accents.slice(0, 2)
  const primary = branding?.primaryColor || DEFAULT_PRIMARY_COLOR
  const secondary = branding?.secondaryColor || DEFAULT_SECONDARY_COLOR
  return [primary, secondary]
}

/** Keep primary/secondary and accentColors aligned when saving from the branding editor. */
export function syncAccentFields(input: {
  primaryColor: string
  secondaryColor: string
  accentColors?: string[]
}): Pick<ShowBranding, 'primaryColor' | 'secondaryColor' | 'accentColors'> {
  const accents =
    input.accentColors && input.accentColors.filter(Boolean).length > 0
      ? input.accentColors.filter(Boolean).slice(0, 2)
      : [input.primaryColor, input.secondaryColor].filter(Boolean).slice(0, 2)

  return {
    primaryColor: accents[0] || input.primaryColor || DEFAULT_PRIMARY_COLOR,
    secondaryColor: accents[1] || input.secondaryColor || accents[0] || DEFAULT_SECONDARY_COLOR,
    accentColors: accents,
  }
}

export function mapShowBranding(branding: ShowBranding | null | undefined): EffectiveBranding {
  return {
    logoUrl: branding?.logoURL || '',
    backgroundColor: branding?.backgroundColor || DEFAULT_BACKGROUND_COLOR,
    textColor: branding?.textColor || DEFAULT_TEXT_COLOR,
    accentColors: showAccentColors(branding),
  }
}

export function effectiveRoomBranding(
  showBranding: ShowBranding | null | undefined,
  roomBranding: RoomBranding | null | undefined,
): EffectiveBranding {
  const base = mapShowBranding(showBranding)
  if (!roomBranding || roomBranding.inherit !== false) return base

  const accents = roomBranding.accentColors?.filter(Boolean).slice(0, 2)
  return {
    logoUrl: roomBranding.logoUrl?.trim() || base.logoUrl,
    backgroundColor: roomBranding.backgroundColor || base.backgroundColor,
    textColor: roomBranding.textColor || base.textColor,
    accentColors: accents && accents.length > 0 ? accents : base.accentColors,
  }
}

export function defaultRoomBranding(): RoomBranding {
  return { inherit: true }
}

export function defaultRoomDocFields(
  name: string,
  createdBy: string,
  createdAt: RoomDoc['createdAt'],
): Omit<RoomDoc, never> {
  return {
    name,
    branding: defaultRoomBranding(),
    createdAt,
    createdBy,
  }
}
