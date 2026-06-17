import type { Capabilities, CustomPermissions, UserDoc } from '@/types'
import { BASE_ROLE_CAPS } from './roles'

/**
 * Resolves the effective capabilities for a user by merging their
 * base role defaults with any granular customPermissions overrides.
 *
 * customPermissions values of `true` or `false` override the base role.
 * Undefined values fall back to the base role default.
 */
export function resolveCapabilities(user: UserDoc): Capabilities {
  const base = BASE_ROLE_CAPS[user.baseRole]
  const overrides = user.customPermissions ?? {}

  return {
    canCreateShows:        overrides.canCreateShows        ?? base.canCreateShows,
    canEditShows:          overrides.canEditShows          ?? base.canEditShows,
    canManageUsers:        overrides.canManageUsers        ?? base.canManageUsers,
    canAccessTechPanel:    overrides.canAccessTechPanel    ?? base.canAccessTechPanel,
    canControlLiveFeed:    overrides.canControlLiveFeed    ?? base.canControlLiveFeed,
    canViewPrivatePreview: overrides.canViewPrivatePreview ?? base.canViewPrivatePreview,
    canApproveTranscripts: overrides.canApproveTranscripts ?? base.canApproveTranscripts,
    canPublishSessions:    overrides.canPublishSessions    ?? base.canPublishSessions,
    canExportTranscripts:  overrides.canExportTranscripts  ?? base.canExportTranscripts,
    canManageBranding:     overrides.canManageBranding     ?? base.canManageBranding,
    canManageOutputLayouts:overrides.canManageOutputLayouts?? base.canManageOutputLayouts,
  }
}

/**
 * Quick helper: check a single capability for a user.
 */
export function can(user: UserDoc, capability: keyof Capabilities): boolean {
  return resolveCapabilities(user)[capability]
}
