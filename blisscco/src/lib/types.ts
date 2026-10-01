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
