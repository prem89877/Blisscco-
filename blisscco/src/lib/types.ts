export type Status = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'suspended' | 'inactive';

export interface Category { id: string; slug: string; name_en: string; name_hi: string | null; name_mr: string | null; is_active: boolean; sort_order: number }
export interface Business {
  id: string; owner_id: string; category_id: string | null; name: string; description: string | null;
  phone: string | null; email: string | null; show_phone_publicly: boolean; show_email_publicly: boolean;
  address_line: string | null; city: string | null; state: string | null; pincode: string | null;
  latitude: number | null; longitude: number | null; status: Status; rejection_reason: string | null; submitted_at: string | null;
}
export interface BizImage { id: string; business_id: string; storage_path: string; sort_order: number }
export interface Hour { day_of_week: number; opens_at: string | null; closes_at: string | null; is_closed: boolean }
export interface Service {
  id: string; business_id: string; name: string | null; service_category: string; description: string | null;
  price_inr: number; duration_minutes: number | null; is_active: boolean;
}
export interface Loaded { business: Business; categories: Category[]; images: BizImage[]; hours: Hour[]; services: Service[] }

export type BookingStatus = 'pending' | 'confirmed' | 'checked_in' | 'in_service' | 'completed' | 'cancelled' | 'no_show';
export interface Booking {
  id: string; business_id: string; business_name: string; customer_id: string | null; customer_name: string | null;
  guest_name: string | null; source: 'customer' | 'owner'; service_id: string; service_label: string; price_inr: number;
  type: 'appointment' | 'walkin'; status: BookingStatus; start_at: string | null; end_at: string | null;
  queue_date: string | null; token_number: number | null; created_at: string;
}
export interface QueueInfo {
  queue_status: 'open' | 'paused' | 'closed'; temporarily_unavailable: boolean; est_wait_minutes: number | null;
  queue_updated_at: string; waiting_count: number; serving_count: number; serving_token: number | null; next_token: number | null;
  walkin_enabled: boolean; appointments_enabled: boolean; slot_minutes: number; max_days_ahead: number;
}
export interface BookingSettings {
  business_id: string; appointments_enabled: boolean; walkin_enabled: boolean; slot_minutes: number; capacity: number;
  max_days_ahead: number; queue_status: 'open' | 'paused' | 'closed'; est_wait_minutes: number | null;
  temporarily_unavailable: boolean; queue_updated_at: string;
}
