import type { Capabilities, BaseRole, CustomPermissions } from '@/types'

// ─────────────────────────────────────────────
// Base role capability defaults
// ─────────────────────────────────────────────

export const BASE_ROLE_CAPS: Record<BaseRole, Capabilities> = {
  admin: {
    canCreateShows:       true,
    canEditShows:         true,
    canManageUsers:       true,
    canAccessTechPanel:   true,
    canControlLiveFeed:   true,
    canViewPrivatePreview:true,
    canApproveTranscripts:true,
    canPublishSessions:   true,
    canExportTranscripts: true,
    canManageBranding:    true,
    canManageOutputLayouts:true,
  },
  editor: {
    canCreateShows:       true,
    canEditShows:         true,
    canManageUsers:       false,
    canAccessTechPanel:   false,
    canControlLiveFeed:   false,
    canViewPrivatePreview:false,
    canApproveTranscripts:false,
    canPublishSessions:   true,
    canExportTranscripts: true,
    canManageBranding:    true,
    canManageOutputLayouts:true,
  },
  tech: {
    canCreateShows:       false,
    canEditShows:         false,
    canManageUsers:       false,
    canAccessTechPanel:   true,
    canControlLiveFeed:   true,
    canViewPrivatePreview:true,
    canApproveTranscripts:false,
    canPublishSessions:   false,
    canExportTranscripts: false,
    canManageBranding:    false,
    canManageOutputLayouts:true,
  },
  reviewer: {
    canCreateShows:       false,
    canEditShows:         false,
    canManageUsers:       false,
    canAccessTechPanel:   false,
    canControlLiveFeed:   false,
    canViewPrivatePreview:false,
    canApproveTranscripts:true,
    canPublishSessions:   false,
    canExportTranscripts: true,
    canManageBranding:    false,
    canManageOutputLayouts:false,
  },
}
