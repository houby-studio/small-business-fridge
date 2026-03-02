export const AUDIT_ACTION_I18N_KEYS: Record<string, string> = {
  'order.created': 'audit.action_order_created',
  'invoice.generated': 'audit.action_invoice_generated',
  'payment.requested': 'audit.action_payment_requested',
  'payment.request_cancelled': 'audit.action_payment_request_cancelled',
  'payment.approved': 'audit.action_payment_approved',
  'payment.rejected': 'audit.action_payment_rejected',
  'delivery.created': 'audit.action_delivery_created',
  'product.created': 'audit.action_product_created',
  'product.updated': 'audit.action_product_updated',
  'allergen.created': 'audit.action_allergen_created',
  'allergen.updated': 'audit.action_allergen_updated',
  'allergen.deleted': 'audit.action_allergen_deleted',
  'category.created': 'audit.action_category_created',
  'category.updated': 'audit.action_category_updated',
  'category.deleted': 'audit.action_category_deleted',
  'music.created': 'audit.action_music_created',
  'music.updated': 'audit.action_music_updated',
  'music.deleted': 'audit.action_music_deleted',
  'profile.updated': 'audit.action_profile_updated',
  'favorite.added': 'audit.action_favorite_added',
  'favorite.removed': 'audit.action_favorite_removed',
  'user.updated': 'audit.action_user_updated',
  'order.storno': 'audit.action_order_storno',
  'user.login': 'audit.action_user_login',
  'user.registered': 'audit.action_user_registered',
  'user.logout': 'audit.action_user_logout',
  'profile.token.created': 'audit.action_profile_token_created',
  'profile.token.revoked': 'audit.action_profile_token_revoked',
  'admin.impersonate.start': 'audit.action_admin_impersonate_start',
  'admin.impersonate.stop': 'audit.action_admin_impersonate_stop',
  'invitation.created': 'audit.action_invitation_created',
  'invitation.revoked': 'audit.action_invitation_revoked',
  'invitation.accepted': 'audit.action_invitation_accepted',
  'user.identity.linked': 'audit.action_user_identity_linked',
  'user.password_reset': 'audit.action_user_password_reset',
  'user.password_changed': 'audit.action_user_password_changed',
  'user.password_reset.requested': 'audit.action_user_password_reset_requested',
}

export type TranslateFn = (key: string) => string

export function formatUnknownAuditAction(action: string): string {
  return action.replace(/[._]+/g, ' ').trim().toLowerCase()
}

export function getAuditActionLabel(action: string | undefined, t: TranslateFn): string {
  if (!action) return ''

  const key = AUDIT_ACTION_I18N_KEYS[action]
  if (key) {
    return t(key)
  }

  return formatUnknownAuditAction(action)
}

export function getAuditActionOptions(
  t: TranslateFn,
  allLabel: string,
  allValue: string
): Array<{ label: string; value: string }> {
  return [
    { label: allLabel, value: allValue },
    ...Object.keys(AUDIT_ACTION_I18N_KEYS).map((action) => ({
      label: getAuditActionLabel(action, t),
      value: action,
    })),
  ]
}
