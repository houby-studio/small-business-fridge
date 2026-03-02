import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'home.index': { paramsTuple?: []; params?: {} }
    'bootstrap.show': { paramsTuple?: []; params?: {} }
    'bootstrap.store': { paramsTuple?: []; params?: {} }
    'login.show': { paramsTuple?: []; params?: {} }
    'login.store': { paramsTuple?: []; params?: {} }
    'register.show': { paramsTuple?: []; params?: {} }
    'register.store': { paramsTuple?: []; params?: {} }
    'password_reset.show_forgot': { paramsTuple?: []; params?: {} }
    'password_reset.send_reset': { paramsTuple?: []; params?: {} }
    'password_reset.show_reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password_reset.reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'invite_registration.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'invite_registration.store': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'oidc.redirect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'oidc.callback': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'logout.get': { paramsTuple?: []; params?: {} }
    'logout.post': { paramsTuple?: []; params?: {} }
    'admin_impersonation.destroy': { paramsTuple?: []; params?: {} }
    'shop.index': { paramsTuple?: []; params?: {} }
    'shop.purchase': { paramsTuple?: []; params?: {} }
    'orders.index': { paramsTuple?: []; params?: {} }
    'invoices.index': { paramsTuple?: []; params?: {} }
    'invoices.request_paid': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.cancel_paid': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.qrcode': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'profile.show': { paramsTuple?: []; params?: {} }
    'profile.update': { paramsTuple?: []; params?: {} }
    'profile.update_excluded_allergens': { paramsTuple?: []; params?: {} }
    'profile.toggle_color_mode': { paramsTuple?: []; params?: {} }
    'profile.toggle_favorite': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'profile.create_token': { paramsTuple?: []; params?: {} }
    'profile.revoke_token': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'password_reset.change_authenticated': { paramsTuple?: []; params?: {} }
    'audit.index': { paramsTuple?: []; params?: {} }
    'supplier_deliveries.index': { paramsTuple?: []; params?: {} }
    'supplier_deliveries.store': { paramsTuple?: []; params?: {} }
    'supplier_invoice.index': { paramsTuple?: []; params?: {} }
    'supplier_invoice.generate': { paramsTuple?: []; params?: {} }
    'supplier_invoice.generate_for_buyer': { paramsTuple: [ParamValue]; params: {'buyerId': ParamValue} }
    'supplier_payments.index': { paramsTuple?: []; params?: {} }
    'supplier_payments.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'supplier_stock.index': { paramsTuple?: []; params?: {} }
    'supplier_products.index': { paramsTuple?: []; params?: {} }
    'supplier_products.create': { paramsTuple?: []; params?: {} }
    'supplier_products.store': { paramsTuple?: []; params?: {} }
    'supplier_products.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'supplier_products.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_dashboard.index': { paramsTuple?: []; params?: {} }
    'admin_users.index': { paramsTuple?: []; params?: {} }
    'admin_users.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_invitations.store': { paramsTuple?: []; params?: {} }
    'admin_invitations.revoke': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_categories.index': { paramsTuple?: []; params?: {} }
    'admin_categories.store': { paramsTuple?: []; params?: {} }
    'admin_categories.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_categories.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_allergens.index': { paramsTuple?: []; params?: {} }
    'admin_allergens.store': { paramsTuple?: []; params?: {} }
    'admin_allergens.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_allergens.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_music_tracks.index': { paramsTuple?: []; params?: {} }
    'admin_music_tracks.store': { paramsTuple?: []; params?: {} }
    'admin_music_tracks.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_music_tracks.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_orders.index': { paramsTuple?: []; params?: {} }
    'admin_invoices.index': { paramsTuple?: []; params?: {} }
    'admin_storno.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_audit.index': { paramsTuple?: []; params?: {} }
    'admin_impersonation.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.generate_invoice': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.send_password_reset': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'kiosk.index': { paramsTuple?: []; params?: {} }
    'kiosk.identify': { paramsTuple?: []; params?: {} }
    'kiosk.purchase_basket': { paramsTuple?: []; params?: {} }
    'kiosk.shop': { paramsTuple?: []; params?: {} }
    'kiosk.purchase': { paramsTuple?: []; params?: {} }
    'api_auth.login': { paramsTuple?: []; params?: {} }
    'api_auth.token': { paramsTuple?: []; params?: {} }
    'api_health.index': { paramsTuple?: []; params?: {} }
    'api_products.index': { paramsTuple?: []; params?: {} }
    'api_products.show': { paramsTuple: [ParamValue]; params: {'barcode': ParamValue} }
    'api_orders.store': { paramsTuple?: []; params?: {} }
    'api_orders.latest': { paramsTuple?: []; params?: {} }
    'api_customers.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api_customers.insights': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  GET: {
    'home.index': { paramsTuple?: []; params?: {} }
    'bootstrap.show': { paramsTuple?: []; params?: {} }
    'login.show': { paramsTuple?: []; params?: {} }
    'register.show': { paramsTuple?: []; params?: {} }
    'password_reset.show_forgot': { paramsTuple?: []; params?: {} }
    'password_reset.show_reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'invite_registration.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'oidc.redirect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'oidc.callback': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'logout.get': { paramsTuple?: []; params?: {} }
    'shop.index': { paramsTuple?: []; params?: {} }
    'orders.index': { paramsTuple?: []; params?: {} }
    'invoices.index': { paramsTuple?: []; params?: {} }
    'profile.show': { paramsTuple?: []; params?: {} }
    'audit.index': { paramsTuple?: []; params?: {} }
    'supplier_deliveries.index': { paramsTuple?: []; params?: {} }
    'supplier_invoice.index': { paramsTuple?: []; params?: {} }
    'supplier_payments.index': { paramsTuple?: []; params?: {} }
    'supplier_stock.index': { paramsTuple?: []; params?: {} }
    'supplier_products.index': { paramsTuple?: []; params?: {} }
    'supplier_products.create': { paramsTuple?: []; params?: {} }
    'supplier_products.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_dashboard.index': { paramsTuple?: []; params?: {} }
    'admin_users.index': { paramsTuple?: []; params?: {} }
    'admin_categories.index': { paramsTuple?: []; params?: {} }
    'admin_allergens.index': { paramsTuple?: []; params?: {} }
    'admin_music_tracks.index': { paramsTuple?: []; params?: {} }
    'admin_orders.index': { paramsTuple?: []; params?: {} }
    'admin_invoices.index': { paramsTuple?: []; params?: {} }
    'admin_audit.index': { paramsTuple?: []; params?: {} }
    'kiosk.index': { paramsTuple?: []; params?: {} }
    'kiosk.identify': { paramsTuple?: []; params?: {} }
    'kiosk.shop': { paramsTuple?: []; params?: {} }
    'api_health.index': { paramsTuple?: []; params?: {} }
    'api_products.index': { paramsTuple?: []; params?: {} }
    'api_products.show': { paramsTuple: [ParamValue]; params: {'barcode': ParamValue} }
    'api_orders.latest': { paramsTuple?: []; params?: {} }
    'api_customers.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api_customers.insights': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  HEAD: {
    'home.index': { paramsTuple?: []; params?: {} }
    'bootstrap.show': { paramsTuple?: []; params?: {} }
    'login.show': { paramsTuple?: []; params?: {} }
    'register.show': { paramsTuple?: []; params?: {} }
    'password_reset.show_forgot': { paramsTuple?: []; params?: {} }
    'password_reset.show_reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'invite_registration.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'oidc.redirect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'oidc.callback': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'logout.get': { paramsTuple?: []; params?: {} }
    'shop.index': { paramsTuple?: []; params?: {} }
    'orders.index': { paramsTuple?: []; params?: {} }
    'invoices.index': { paramsTuple?: []; params?: {} }
    'profile.show': { paramsTuple?: []; params?: {} }
    'audit.index': { paramsTuple?: []; params?: {} }
    'supplier_deliveries.index': { paramsTuple?: []; params?: {} }
    'supplier_invoice.index': { paramsTuple?: []; params?: {} }
    'supplier_payments.index': { paramsTuple?: []; params?: {} }
    'supplier_stock.index': { paramsTuple?: []; params?: {} }
    'supplier_products.index': { paramsTuple?: []; params?: {} }
    'supplier_products.create': { paramsTuple?: []; params?: {} }
    'supplier_products.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_dashboard.index': { paramsTuple?: []; params?: {} }
    'admin_users.index': { paramsTuple?: []; params?: {} }
    'admin_categories.index': { paramsTuple?: []; params?: {} }
    'admin_allergens.index': { paramsTuple?: []; params?: {} }
    'admin_music_tracks.index': { paramsTuple?: []; params?: {} }
    'admin_orders.index': { paramsTuple?: []; params?: {} }
    'admin_invoices.index': { paramsTuple?: []; params?: {} }
    'admin_audit.index': { paramsTuple?: []; params?: {} }
    'kiosk.index': { paramsTuple?: []; params?: {} }
    'kiosk.identify': { paramsTuple?: []; params?: {} }
    'kiosk.shop': { paramsTuple?: []; params?: {} }
    'api_health.index': { paramsTuple?: []; params?: {} }
    'api_products.index': { paramsTuple?: []; params?: {} }
    'api_products.show': { paramsTuple: [ParamValue]; params: {'barcode': ParamValue} }
    'api_orders.latest': { paramsTuple?: []; params?: {} }
    'api_customers.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api_customers.insights': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  POST: {
    'bootstrap.store': { paramsTuple?: []; params?: {} }
    'login.store': { paramsTuple?: []; params?: {} }
    'register.store': { paramsTuple?: []; params?: {} }
    'password_reset.send_reset': { paramsTuple?: []; params?: {} }
    'password_reset.reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'invite_registration.store': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'logout.post': { paramsTuple?: []; params?: {} }
    'admin_impersonation.destroy': { paramsTuple?: []; params?: {} }
    'shop.purchase': { paramsTuple?: []; params?: {} }
    'invoices.request_paid': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.cancel_paid': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.qrcode': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'profile.toggle_color_mode': { paramsTuple?: []; params?: {} }
    'profile.toggle_favorite': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'profile.create_token': { paramsTuple?: []; params?: {} }
    'supplier_deliveries.store': { paramsTuple?: []; params?: {} }
    'supplier_invoice.generate': { paramsTuple?: []; params?: {} }
    'supplier_invoice.generate_for_buyer': { paramsTuple: [ParamValue]; params: {'buyerId': ParamValue} }
    'supplier_payments.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'supplier_products.store': { paramsTuple?: []; params?: {} }
    'admin_invitations.store': { paramsTuple?: []; params?: {} }
    'admin_invitations.revoke': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_categories.store': { paramsTuple?: []; params?: {} }
    'admin_allergens.store': { paramsTuple?: []; params?: {} }
    'admin_music_tracks.store': { paramsTuple?: []; params?: {} }
    'admin_storno.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_impersonation.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.generate_invoice': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.send_password_reset': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'kiosk.purchase_basket': { paramsTuple?: []; params?: {} }
    'kiosk.purchase': { paramsTuple?: []; params?: {} }
    'api_auth.login': { paramsTuple?: []; params?: {} }
    'api_auth.token': { paramsTuple?: []; params?: {} }
    'api_orders.store': { paramsTuple?: []; params?: {} }
  }
  PUT: {
    'profile.update': { paramsTuple?: []; params?: {} }
    'profile.update_excluded_allergens': { paramsTuple?: []; params?: {} }
    'password_reset.change_authenticated': { paramsTuple?: []; params?: {} }
    'supplier_products.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_users.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_categories.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_allergens.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_music_tracks.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  DELETE: {
    'profile.revoke_token': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_categories.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_allergens.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin_music_tracks.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}