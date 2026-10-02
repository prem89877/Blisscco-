import { supabase } from './supabase';

export const BUCKET = 'business-images';
export const BANNER_BUCKET = 'banner-images';
export const VDOC_BUCKET = 'verification-docs';
export const MAX_BYTES = 5 * 1024 * 1024;
export const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function signedUrlMap(paths: string[], bucket: string = BUCKET): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
  const out: Record<string, string> = {};
  data?.forEach((d) => { if (d.path && d.signedUrl) out[d.path] = d.signedUrl; });
  return out;
}
