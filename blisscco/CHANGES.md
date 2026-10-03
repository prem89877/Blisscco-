# Blisscco update: AI price suggestion + nicer Browse cards + scrollable services + pink Confirm button

## Supabase me kuch run nahi karna (koi SQL change nahi)

## Vercel
Naya API file `api/ai-price-suggest.ts` apne aap deploy hoga. Wahi env vars chalenge jo AI insights ke liye hain (AI_API_KEY, AI_PROVIDER, AI_MODEL, AI_BASE_URL). Naye env var ki zaroorat nahi.

## New files
- api/ai-price-suggest.ts

## Changed files
- src/components/editor/ServicesSection.tsx  (AI price suggestion button + 1-2 line result)
- src/pages/Explore.tsx  (Browse shops: naye shop cards)
- src/pages/BusinessProfile.tsx  (services horizontal scroll, pink border pills)
- src/components/BookingPanel.tsx  (Confirm booking button -> #ff91a4)
- src/index.css  (naye styles: btn-confirm, btn-ai, ai-tip, svc-row, svc-pill, shop-card)
- src/i18n/messages.ts  (naye texts: EN / HI / MR)
- vercel.json  (ai-price-suggest function timeout)
- CHANGES.md
