export interface WeddingEvent {
  appearance: Appearance;
  title: string;
  theme: string;
  position: 'left' | 'center' | 'right';
  images: Partial<Record<ImageSlot, string>>;
  filters: string[];
  revision: number;
  partner_one: string;
  partner_two: string;
  wedding_date: string;
  venue: string;
  welcome_message: string;
}
export interface Appearance {
  preset: string;
  background: string;
  font: 'classic' | 'book' | 'modern' | 'retro';
  ornament: 'signature' | 'floral' | 'none';
  scale: number;
  button: 'soft' | 'square' | 'pill';
  buttonLabel: string;
}
export type ImageSlot = 'background' | 'hero' | 'logo' | 'decoration' | 'banner' | 'couple';
export interface Project {
  id: string;
  owner_id: string;
  name: string;
  username: string;
  code: string | null;
  qr_count: number;
  photo_count: number | null;
}
export interface StudioUser {
  id: string;
  email: string;
  username: string;
  role: 'super' | 'project';
  active: number;
}
export interface Qr {
  project_id: string;
  project_name: string;
  username: string;
  id: string;
  label: string;
  code: string;
  total_limit: number;
  per_session_limit: number;
  used_count: number;
  active: boolean;
  remaining: number;
  max_sessions: number;
  sessions: number;
  allocated_sessions: number;
  unallocated: number;
  url: string;
  created_at: string;
}
export interface Photo {
  id: string;
  url: string;
  thumbnail: string;
  created_at: string;
  width: number;
  height: number;
  message: string;
  qr_label?: string;
  qr_id?: string;
  session_id?: string;
  original_filename?: string;
  file_size?: number;
}
export interface PhotoList {
  photos: Photo[];
  total: number;
  page: number;
  pages: number;
}
export interface GuestSession {
  id: string;
  csrf: string;
  photo_count: number;
  photo_limit: number;
  remaining: number;
  expires_at: string;
  label: string;
}
export interface Auth {
  user_id?: string;
  username?: string;
  role?: 'project' | 'super';
  authenticated: boolean;
  csrf: string;
  email?: string;
  setup_required?: boolean;
}
export interface Overview {
  projects: { id: string; name: string; total: number }[];
  users?: number;
  recent: { id: string; name: string; label: string; created_at: string }[];
  total_qr: number;
  active_qr: number;
  total_quota: number;
  used_quota: number;
  uploaded: number;
  published: number;
  remaining_quota: number;
  sessions: number;
  days: { day: string; count: number }[];
}
export interface Usage {
  qr: Qr;
  total: number;
  page: number;
  pages: number;
  sessions: {
    id: string;
    photo_count: number;
    photo_limit: number;
    status: string;
    created_at: string;
    expires_at: string;
  }[];
}
