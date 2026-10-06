import { z } from 'zod';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';
import { modes, surfaceKinds } from './surfaces-form.model';

function uuid(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const parsed = canonicalUuidSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : undefined;
}
const surfacesSearchSchema = z.preprocess((input) => {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const profiles = raw.tab === 'profiles';
  const q = typeof raw.q === 'string' ? raw.q.trim() : '';
  const surfaceId = uuid(raw.surface_id);
  const profileId = profiles ? uuid(raw.profile_id) : undefined;
  const creating = raw.new === 1 || raw.new === '1';
  const selected = profiles ? profileId : surfaceId;
  const isActive = raw.is_active === true || raw.is_active === 'true' ? true : raw.is_active === false || raw.is_active === 'false' ? false : undefined;
  const page = Number(raw.page);
  const size = Number(raw.page_size);
  const surfaceKind = z.enum(surfaceKinds).safeParse(raw.surface_kind);
  const mode = z.enum(modes).safeParse(raw.collection_mode);
  return {
    ...(profiles ? { tab: 'profiles' } : {}), ...(q && q.length <= 240 ? { q } : {}),
    ...(isActive !== undefined ? { is_active: isActive } : {}),
    ...(profiles ? surfaceId ? { surface_id: surfaceId } : {} : !creating && surfaceId ? { surface_id: surfaceId } : {}),
    ...(!creating && profileId ? { profile_id: profileId } : {}),
    ...(!profiles && surfaceKind.success ? { surface_kind: surfaceKind.data } : {}),
    ...(profiles && mode.success ? { collection_mode: mode.data } : {}),
    ...(raw.sort === 'UPDATED_DESC' ? { sort: 'UPDATED_DESC' } : {}),
    ...(Number.isSafeInteger(page) && page > 1 ? { page } : {}),
    ...(size === 10 || size === 50 ? { page_size: size } : {}),
    ...(creating ? { new: 1 } : selected && (raw.editor === 1 || raw.editor === '1') ? { editor: 1 } : {}),
  };
}, z.object({
  tab: z.literal('profiles').optional(), q: z.string().max(240).optional(), is_active: z.boolean().optional(),
  surface_id: z.uuid().optional(), profile_id: z.uuid().optional(), surface_kind: z.enum(surfaceKinds).optional(), collection_mode: z.enum(modes).optional(),
  sort: z.literal('UPDATED_DESC').optional(), page: z.number().int().positive().optional(), page_size: z.union([z.literal(10), z.literal(50)]).optional(),
  new: z.literal(1).optional(), editor: z.literal(1).optional(),
}));
type SurfacesSearch = z.output<typeof surfacesSearchSchema>;
function surfacesEditorIdentity(search: SurfacesSearch) {
  const kind = search.tab ?? 'surfaces';
  if (search.new) return `${kind}:new`;
  const id = search.tab === 'profiles' ? search.profile_id : search.surface_id;
  return `${kind}:${id ?? 'none'}:${search.editor ?? 'view'}`;
}
function shouldBlockSurfacesNavigation(current: { pathname: string; search: unknown }, next: { pathname: string; search: unknown }) {
  return current.pathname !== next.pathname || surfacesEditorIdentity(surfacesSearchSchema.parse(current.search)) !== surfacesEditorIdentity(surfacesSearchSchema.parse(next.search));
}
function isCanonicalSurfacesSearch(raw: Record<string, unknown>, search: SurfacesSearch) {
  return Object.keys(raw).length === Object.keys(search).length && Object.entries(search).every(([key, value]) => (typeof raw[key] === 'string' || typeof raw[key] === typeof value) && String(raw[key]) === String(value));
}
export { surfacesSearchSchema, surfacesEditorIdentity, shouldBlockSurfacesNavigation, isCanonicalSurfacesSearch };
export type { SurfacesSearch };
