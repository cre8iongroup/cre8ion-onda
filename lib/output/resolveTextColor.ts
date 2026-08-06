/**
 * Resolve display text color for an Output Window.
 * Explicit window.textColor wins; otherwise show/room branding text color.
 */

import { DEFAULT_TEXT_COLOR } from '@/lib/branding'
import type { OutputWindowConfig } from '@/types'

export function resolveOutputTextColor(
  windowConfig: Pick<OutputWindowConfig, 'textColor'> | null | undefined,
  brandTextColor: string | null | undefined,
): string {
  const override = windowConfig?.textColor?.trim()
  if (override) return override
  const brand = brandTextColor?.trim()
  if (brand) return brand
  return DEFAULT_TEXT_COLOR
}
