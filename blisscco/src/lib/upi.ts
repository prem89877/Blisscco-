/** UPI ID (VPA) format: name@bank, e.g. shop.owner@oksbi. Same rule as the database (migration 0035). */
const UPI_RE = /^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,31}$/;

export const normalizeUpi = (v: string) => v.trim().toLowerCase();
export const isValidUpi = (v: string) => UPI_RE.test(normalizeUpi(v));
