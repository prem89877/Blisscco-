import { INDIA_POLYGONS } from './indiaGeo';

// ---------- Coordinates ----------
export type CoordCheck = { ok: true } | { ok: false; reason: 'invalid_lat' | 'invalid_lng' | 'outside_india' };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// Ray casting. ring = [[lng, lat], ...] (closed or open, both work).
function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function isInsideIndiaPolygon(lat: number, lng: number): boolean {
  // quick box first (mainland + islands), then the polygon
  if (lat < 6.5 || lat > 35.9 || lng < 68 || lng > 97.5) return false;
  return INDIA_POLYGONS.some(([outer, ...holes]) => inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h)));
}

// Step 1: is latitude a real latitude?  Step 2: is longitude a real longitude?  Step 3: is the point inside India?
export function checkIndiaCoords(lat: unknown, lng: unknown): CoordCheck {
  if (!isNum(lat) || lat < -90 || lat > 90) return { ok: false, reason: 'invalid_lat' };
  if (!isNum(lng) || lng < -180 || lng > 180) return { ok: false, reason: 'invalid_lng' };
  if (lat === 0 && lng === 0) return { ok: false, reason: 'outside_india' };
  return isInsideIndiaPolygon(lat, lng) ? { ok: true } : { ok: false, reason: 'outside_india' };
}

export const coordErrorKey = (reason: 'invalid_lat' | 'invalid_lng' | 'outside_india') =>
  reason === 'outside_india' ? 'geo.outsideIndia' : 'geo.invalidCoords';

// ---------- States / union territories ----------
const STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal',
] as const;
export type StateName = (typeof STATES)[number];

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// short forms and old names people type
const ALIASES: Record<string, StateName> = {
  an: 'Andaman and Nicobar Islands', 'andaman nicobar': 'Andaman and Nicobar Islands', 'andaman and nicobar': 'Andaman and Nicobar Islands',
  ap: 'Andhra Pradesh', ar: 'Arunachal Pradesh', as: 'Assam', br: 'Bihar', ch: 'Chandigarh', cg: 'Chhattisgarh', chattisgarh: 'Chhattisgarh',
  dn: 'Dadra and Nagar Haveli and Daman and Diu', dd: 'Dadra and Nagar Haveli and Daman and Diu', dnhdd: 'Dadra and Nagar Haveli and Daman and Diu',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu', 'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  dl: 'Delhi', 'nct of delhi': 'Delhi', 'new delhi': 'Delhi', ga: 'Goa', gj: 'Gujarat', hr: 'Haryana', hp: 'Himachal Pradesh',
  jk: 'Jammu and Kashmir', 'j and k': 'Jammu and Kashmir', jh: 'Jharkhand', ka: 'Karnataka', kl: 'Kerala', la: 'Ladakh', ld: 'Lakshadweep',
  mp: 'Madhya Pradesh', mh: 'Maharashtra', mn: 'Manipur', ml: 'Meghalaya', mz: 'Mizoram', nl: 'Nagaland', od: 'Odisha', or: 'Odisha',
  orissa: 'Odisha', py: 'Puducherry', pondicherry: 'Puducherry', pb: 'Punjab', rj: 'Rajasthan', sk: 'Sikkim', tn: 'Tamil Nadu',
  tamilnadu: 'Tamil Nadu', ts: 'Telangana', tg: 'Telangana', tr: 'Tripura', up: 'Uttar Pradesh', uk: 'Uttarakhand', uttaranchal: 'Uttarakhand',
  ut: 'Uttarakhand', wb: 'West Bengal', 'paschim banga': 'West Bengal',
};
const STATE_LOOKUP: Record<string, StateName> = {
  ...Object.fromEntries(STATES.map((s) => [norm(s), s])),
  ...ALIASES,
};

// Returns the official name, or null if it is not an Indian state / UT.
export function canonicalState(input: string): StateName | null {
  return STATE_LOOKUP[norm(input)] ?? null;
}

// ---------- PIN code ----------
// First two digits of a PIN -> state(s) / UT(s) that use it. Shared prefixes are listed together on purpose
// (for example 24 and 26 are used by both Uttar Pradesh and Uttarakhand). 90-99 are army post offices, not shops.
const S = (...a: StateName[]) => a;
const PREFIX: Record<string, StateName[]> = {
  '11': S('Delhi'), '12': S('Haryana'), '13': S('Haryana'), '14': S('Punjab'), '15': S('Punjab'), '16': S('Punjab', 'Chandigarh'),
  '17': S('Himachal Pradesh'), '18': S('Jammu and Kashmir', 'Ladakh'), '19': S('Jammu and Kashmir', 'Ladakh'),
  '20': S('Uttar Pradesh'), '21': S('Uttar Pradesh'), '22': S('Uttar Pradesh'), '23': S('Uttar Pradesh'),
  '24': S('Uttar Pradesh', 'Uttarakhand'), '25': S('Uttar Pradesh'), '26': S('Uttar Pradesh', 'Uttarakhand'),
  '27': S('Uttar Pradesh'), '28': S('Uttar Pradesh'),
  '30': S('Rajasthan'), '31': S('Rajasthan'), '32': S('Rajasthan'), '33': S('Rajasthan'), '34': S('Rajasthan'),
  '36': S('Gujarat'), '37': S('Gujarat'), '38': S('Gujarat'), '39': S('Gujarat', 'Dadra and Nagar Haveli and Daman and Diu'),
  '40': S('Maharashtra', 'Goa'), '41': S('Maharashtra'), '42': S('Maharashtra'), '43': S('Maharashtra'), '44': S('Maharashtra'),
  '45': S('Madhya Pradesh'), '46': S('Madhya Pradesh'), '47': S('Madhya Pradesh'), '48': S('Madhya Pradesh'), '49': S('Chhattisgarh'),
  '50': S('Telangana', 'Andhra Pradesh'), '51': S('Andhra Pradesh', 'Telangana'), '52': S('Andhra Pradesh', 'Telangana'), '53': S('Andhra Pradesh', 'Puducherry'),
  '56': S('Karnataka'), '57': S('Karnataka'), '58': S('Karnataka'), '59': S('Karnataka'),
  '60': S('Tamil Nadu', 'Puducherry'), '61': S('Tamil Nadu', 'Puducherry'), '62': S('Tamil Nadu'), '63': S('Tamil Nadu'), '64': S('Tamil Nadu'),
  '67': S('Kerala', 'Puducherry'), '68': S('Kerala', 'Lakshadweep'), '69': S('Kerala'),
  '70': S('West Bengal'), '71': S('West Bengal'), '72': S('West Bengal'), '73': S('West Bengal', 'Sikkim'), '74': S('West Bengal', 'Andaman and Nicobar Islands'),
  '75': S('Odisha'), '76': S('Odisha'), '77': S('Odisha'), '78': S('Assam'),
  '79': S('Arunachal Pradesh', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Tripura'),
  '80': S('Bihar'), '81': S('Bihar', 'Jharkhand'), '82': S('Bihar', 'Jharkhand'), '83': S('Jharkhand'), '84': S('Bihar'), '85': S('Bihar', 'Jharkhand'),
};

export type PinCheck = { ok: true; states: StateName[] } | { ok: false; reason: 'format' | 'unknown_prefix' };

export function checkPincode(raw: string): PinCheck {
  const p = raw.trim();
  if (!/^[1-9][0-9]{5}$/.test(p)) return { ok: false, reason: 'format' };
  const states = PREFIX[p.slice(0, 2)];
  return states ? { ok: true, states } : { ok: false, reason: 'unknown_prefix' };
}

// ---------- Whole address ----------
export interface AddressInput { address_line: string; city: string; state: string; pincode: string }
export type AddressError =
  | 'addr_short' | 'addr_chars' | 'city_invalid' | 'state_unknown' | 'pin_format' | 'pin_unknown' | 'pin_state_mismatch';
export interface AddressResult { errors: AddressError[]; state: StateName | null }

// requireAll = true when submitting for review (everything must be present); false while saving a draft
// (only what the owner typed is checked).
export function validateAddress(a: AddressInput, requireAll: boolean): AddressResult {
  const errors: AddressError[] = [];
  const line = a.address_line.trim();
  const city = a.city.trim();
  const stateIn = a.state.trim();
  const pin = a.pincode.trim();

  if (line || requireAll) {
    if (line.length < 5) errors.push('addr_short');
    else if (!/\p{L}/u.test(line)) errors.push('addr_chars');
  }
  if (city || requireAll) {
    if (!/^[\p{L}\p{M}][\p{L}\p{M} .'()-]{1,79}$/u.test(city)) errors.push('city_invalid');
  }
  const state = stateIn ? canonicalState(stateIn) : null;
  if ((stateIn || requireAll) && !state) errors.push('state_unknown');

  if (pin || requireAll) {
    const pc = checkPincode(pin);
    if (!pc.ok) errors.push(pc.reason === 'format' ? 'pin_format' : 'pin_unknown');
    else if (state && !pc.states.includes(state)) errors.push('pin_state_mismatch');
  }
  return { errors, state };
}

export const addressErrorKey = (e: AddressError) => `addr.err.${e}`;

// Suggest a state from a PIN when there is only one possible state (used to pre-fill the state box).
export function stateFromPincode(pin: string): StateName | null {
  const pc = checkPincode(pin);
  return pc.ok && pc.states.length === 1 ? pc.states[0] : null;
}
