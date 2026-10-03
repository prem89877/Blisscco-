export type Status = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'suspended' | 'inactive';

export interface Category { id: string;slug: string;name_en: string;name_hi: string | null;name_mr: string | null;is_active: boolean;sort_order: number }
export interface Business {
  id: string;owner_id: string;category_id: string | null;name: string;description: string | null;
  phone: string | null;email: string | null;show_phone_publicly: boolean;show_email_publicly: boolean;
  address_line: string | null;city: string | null;state: string | null;pincode: string | null;
  latitude: number | null;longitude: number | null;status: Status;rejection_reason: string | null;submitted_at: string | null;
}
export interface BizImage { id: string;business_id: string;storage_path: string;sort_order: number }
export interface Hour { day_of_week: number;opens_at: string | null;closes_at: string | null;is_closed: boolean }
export interface Service {
  id: string;business_id: string;name: string | null;service_category: string;description: string | null;
  price_inr: number;duration_minutes: number | null;is_active: boolean;
}
export interface Loaded { business: Business;categories: Category[];images: BizImage[];hours: Hour[];services: Service[] }

export type BookingStatus = 'pending' | 'confirmed' | 'checked_in' | 'in_service' | 'completed' | 'cancelled' | 'no_show';
export interface Booking {
  id: string;business_id: string;business_name: string;customer_id: string | null;customer_name: string | null;
  guest_name: string | null;source: 'customer' | 'owner';service_id: string;service_label: string;price_inr: number;
  type: 'appointment' | 'walkin';status: BookingStatus;start_at: string | null;end_at: string | null;
  queue_date: string | null;token_number: number | null;created_at: string;
}
export interface QueueInfo {
  queue_status: 'open' | 'paused' | 'closed';temporarily_unavailable: boolean;est_wait_minutes: number | null;
  queue_updated_at: string;waiting_count: number;serving_count: number;serving_token: number | null;next_token: number | null;
  walkin_enabled: boolean;appointments_enabled: boolean;slot_minutes: number;max_days_ahead: number;
}
export interface BookingSettings {
  business_id: string;appointments_enabled: boolean;walkin_enabled: boolean;slot_minutes: number;capacity: number;
  max_days_ahead: number;queue_status: 'open' | 'paused' | 'closed';est_wait_minutes: number | null;
  temporarily_unavailable: boolean;queue_updated_at: string;accept_coupons: boolean;
}

export interface Coupon {
  id: string;code: string;discount_type: 'percent' | 'flat';discount_value: number;max_discount_inr: number | null;
  min_spend_inr: number;status: 'active' | 'redeemed' | 'revoked';expires_at: string;created_at: string;
}
export interface Review {
  id: string;business_id: string;business_name: string;reviewer_name: string | null;rating: number;comment: string | null;
  status: 'published' | 'removed';owner_response: string | null;created_at: string;
}

// ---- Phase 8 ----
export interface Plan {
  code: string;kind: 'plan' | 'badge' | 'banner_pack';name: string;amount_paise: number;duration_days: number;
  banner_credits: number;sort_order: number;
}
export interface Entitlements {
  verified: boolean;
  verified_expires_at: string | null;credits: number;verification_status: 'pending' | 'approved' | 'rejected' | null;
}
export interface PaymentTxn {
  id: string;business_id: string;plan_code: string;amount_paise: number;status: string;refunded_paise: number;created_at: string;
}
export interface BannerRow {
  id: string;business_id: string;title: string;image_path: string;status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  rejection_reason: string | null;starts_at: string | null;ends_at: string | null;created_at: string;
}
export interface VerificationRow {
  id: string;business_id: string;doc_type: string;doc_path: string;status: 'pending' | 'approved' | 'rejected';rejection_reason: string | null;created_at: string;
}

// ---- Phase 10 ----
export interface DeliveryRow {
  channel: 'push' | 'email';status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';attempts: number;last_error: string | null;sent_at: string | null;
}
export interface NotificationRow {
  id: string;type: string;category: string;data: Record < string,
  unknown > ;link: string | null;read_at: string | null;created_at: string;
  notification_deliveries: DeliveryRow[];
}
export interface NotificationPrefs { push_enabled: boolean;email_enabled: boolean;muted_categories: string[] }