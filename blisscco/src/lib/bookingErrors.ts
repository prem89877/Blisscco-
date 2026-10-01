const KNOWN = ['slot_full', 'slot_passed', 'closed_day', 'out_of_range', 'own_business', 'not_available', 'limit_reached',
  'already_has_token', 'queue_closed', 'invalid_transition', 'not_found', 'duplicate'];

// Database functions raise stable codes; map them to translated text.
export const bookingErrKey = (message: string | undefined) => (message && KNOWN.includes(message) ? `bk.err.${message}` : 'err.generic');
export const RETURN_KEY = 'blisscco.returnTo';
