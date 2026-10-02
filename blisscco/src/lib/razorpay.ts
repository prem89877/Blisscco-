export interface RzpOptions {
  key: string; amount: number; currency: string; name: string; description: string; order_id: string;
  handler: () => void; modal?: { ondismiss?: () => void }; theme?: { color: string };
}
interface RzpInstance { open: () => void; on: (ev: string, cb: () => void) => void }
declare global { interface Window { Razorpay?: new (o: RzpOptions) => RzpInstance } }

let loading: Promise<boolean> | null = null;
export function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  if (!loading) {
    loading = new Promise<boolean>((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = () => resolve(true);
      s.onerror = () => { loading = null; resolve(false); };
      document.body.appendChild(s);
    });
  }
  return loading;
}

export interface OrderResponse { order_id: string; key_id: string; amount: number; currency: string; description: string; txn_id: string }
export const PLAN_ERRORS = ['unauthorized', 'not_owner', 'business_not_approved', 'plan_not_found', 'plan_required', 'verification_required', 'too_many_orders', 'gateway_error', 'server_config'];
