// Cashfree Payments checkout (JS SDK v3). The payment_session_id comes from /api/create-order; the price is never sent from the browser.
export type CashfreeMode = 'sandbox' | 'production';

export interface CheckoutResult {
  error?: { message?: string; code?: string; type?: string };
  redirect?: boolean;
  paymentDetails?: { paymentMessage?: string };
}
interface CashfreeInstance {
  checkout: (o: { paymentSessionId: string; redirectTarget?: '_modal' | '_self' | '_blank' }) => Promise<CheckoutResult | undefined>;
}
declare global { interface Window { Cashfree?: (o: { mode: CashfreeMode }) => CashfreeInstance } }

let loading: Promise<boolean> | null = null;
export function loadCashfree(): Promise<boolean> {
  if (window.Cashfree) return Promise.resolve(true);
  if (!loading) {
    loading = new Promise<boolean>((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      s.onload = () => resolve(true);
      s.onerror = () => { loading = null; resolve(false); };
      document.body.appendChild(s);
    });
  }
  return loading;
}

/** Opens the Cashfree checkout as a popup on top of our page. Returns null if the SDK could not be loaded. */
export async function openCheckout(paymentSessionId: string, mode: CashfreeMode): Promise<CheckoutResult | null> {
  if (!(await loadCashfree()) || !window.Cashfree) return null;
  const cf = window.Cashfree({ mode });
  return (await cf.checkout({ paymentSessionId, redirectTarget: '_modal' })) ?? {};
}

/** The user closed the popup without paying (not a failed payment). */
export function wasDismissed(r: CheckoutResult): boolean {
  const m = `${r.error?.message ?? ''} ${r.error?.code ?? ''} ${r.error?.type ?? ''}`;
  return !r.error || /abort|clos|cancel|dismiss|user_drop/i.test(m);
}

export interface OrderResponse {
  order_id: string; payment_session_id: string; mode: CashfreeMode; amount: number; currency: string; description: string; txn_id: string;
}
export const PLAN_ERRORS = ['unauthorized', 'not_owner', 'business_not_approved', 'plan_not_found', 'plan_required', 'verification_required', 'too_many_orders', 'gateway_error', 'server_config'];
