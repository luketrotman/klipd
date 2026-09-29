-- KLIPD schema. Mirrors src/lib/domain/types.ts.
-- Apply with: supabase db push  (or psql -f)

create extension if not exists "pgcrypto";

create type match_status as enum ('SCHEDULED','RECORDING','UPLOADED','PROCESSING','PLAYER_DETECTION','PLAYER_TRACKING','EVENT_DETECTION','GENERATING_KLIPS','READY','FAILED');
create type event_type as enum ('GOAL','ASSIST','SHOT','SAVE','TACKLE','INTERCEPTION','DRIBBLE','SKILL','NUTMEG','KEY_PASS','CHANCE_CREATED','BLOCK','CELEBRATION','FUNNY_MOMENT','MISTAKE','OTHER');
create type event_source as enum ('MANUAL','MOCK_AI','AI');
create type team_side as enum ('HOME','AWAY');
create type match_format as enum ('5v5','6v6','7v7');
create type camera_kind as enum ('FIXED','VEO','CCTV','MOBILE','UPLOAD');
create type link_method as enum ('SELF_CLAIM','MANUAL','ROSTER','SHIRT_NUMBER','SHIRT_COLOUR','APPEARANCE','FACE','PRE_GAME_CONFIRMATION');
create type event_player_role as enum ('PRIMARY','ASSIST','INVOLVED','OPPONENT');
create type share_channel as enum ('NATIVE','COPY_LINK','WHATSAPP','INSTAGRAM','TIKTOK','DOWNLOAD');

-- users: Supabase Auth owns auth.users; this table holds app-level fields.
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table player_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references users(id) on delete set null, -- null until a booked player claims their profile
  display_name text not null,
  handle text not null unique,
  position text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now()
);

create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  address text not null,
  city text not null
);

create table pitches (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  name text not null,
  format match_format not null default '5v5',
  surface text
);

create table cameras (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid not null references pitches(id) on delete cascade,
  label text not null,
  kind camera_kind not null default 'FIXED',
  status text not null default 'UNKNOWN',
  config jsonb not null default '{}'::jsonb   -- rtsp url, resolution, fps, gop, etc.
);

create table organisers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique
);

create table booking_providers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,          -- 'manual' | 'footy_addicts'
  name text not null
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  venue_id uuid not null references venues(id),
  pitch_id uuid not null references pitches(id),
  organiser_id uuid references organisers(id),
  booking_provider_id uuid not null references booking_providers(id),
  external_booking_ref text,
  kickoff_at timestamptz not null,
  duration_minutes int not null default 40,
  format match_format not null default '5v5',
  status match_status not null default 'SCHEDULED',
  home_team jsonb not null default '{"name":"Blue","colour":"#3b82f6"}',
  away_team jsonb not null default '{"name":"Orange","colour":"#f97316"}',
  score jsonb,                        -- {"home":12,"away":9}
  video_id uuid,                      -- fk added after videos
  created_at timestamptz not null default now()
);
create index on matches (kickoff_at desc);
create index on matches (pitch_id, kickoff_at);
create unique index on matches (booking_provider_id, external_booking_ref) where external_booking_ref is not null;

create table match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid not null references player_profiles(id) on delete cascade,
  team team_side not null,
  shirt_number int,
  source text not null default 'BOOKING',
  unique (match_id, player_id)
);

create table videos (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  provider text not null,             -- 'vimeo' | 'mux' | 'cloudflare' | 's3' | 'upload'
  external_id text not null,
  source_url text not null,
  duration_seconds numeric not null default 0,
  thumbnail_url text,
  width int,
  height int,
  camera_id uuid references cameras(id),
  status text not null default 'PENDING'
);
alter table matches add constraint matches_video_fk foreign key (video_id) references videos(id) on delete set null;

create table processing_jobs (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  stage match_status not null,
  engine text not null,               -- 'MOCK' | 'REAL'
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  log jsonb not null default '[]'::jsonb
);
create index on processing_jobs (match_id, started_at);

create table tracked_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  label text not null,                -- "Player 01"
  team team_side,
  shirt_colour text,
  shirt_number int,
  confidence numeric not null default 0,
  engine text not null default 'MOCK',
  appearance jsonb                    -- embedding / crops for future re-identification
);
create index on tracked_players (match_id);

create table player_links (
  id uuid primary key default gen_random_uuid(),
  tracked_player_id uuid not null unique references tracked_players(id) on delete cascade,
  player_id uuid not null references player_profiles(id) on delete cascade,
  method link_method not null,
  confidence numeric not null default 1,
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  video_id uuid references videos(id) on delete set null,
  type event_type not null,
  timestamp_s numeric not null,
  start_s numeric not null,
  end_s numeric not null,
  confidence numeric not null default 1,
  team team_side,
  source event_source not null default 'MANUAL',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (start_s < end_s)
);
create index on events (match_id, timestamp_s);

create table event_players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  player_id uuid references player_profiles(id) on delete cascade,
  tracked_player_id uuid references tracked_players(id) on delete cascade,
  role event_player_role not null default 'PRIMARY',
  check (player_id is not null or tracked_player_id is not null)
);
create index on event_players (event_id);
create index on event_players (player_id);
create index on event_players (tracked_player_id);

create table klips (
  id text primary key,                -- short public id used in /klip/{id}
  match_id uuid not null references matches(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  video_id uuid not null references videos(id) on delete cascade,
  start_s numeric not null,
  end_s numeric not null,
  title text,
  status text not null default 'VIRTUAL',   -- VIRTUAL (play from source) | RENDERED (clip_url set)
  clip_url text,
  thumbnail_url text,
  created_at timestamptz not null default now()
);
create index on klips (match_id);
create index on klips (event_id);

create table klip_views (
  id uuid primary key default gen_random_uuid(),
  klip_id text not null references klips(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table klip_likes (
  id uuid primary key default gen_random_uuid(),
  klip_id text not null references klips(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (klip_id, user_id)
);
create table klip_shares (
  id uuid primary key default gen_random_uuid(),
  klip_id text not null references klips(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  channel share_channel not null,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  match_id uuid references matches(id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, read, created_at desc);

-- Row level security: public read for shareable content, owner-only writes.
alter table klips enable row level security;
alter table events enable row level security;
alter table matches enable row level security;
alter table player_profiles enable row level security;
alter table klip_likes enable row level security;
alter table notifications enable row level security;

create policy "klips are public" on klips for select using (true);
create policy "events are public" on events for select using (true);
create policy "matches are public" on matches for select using (true);
create policy "profiles are public" on player_profiles for select using (true);
create policy "own profile" on player_profiles for update using (user_id = auth.uid());
create policy "own likes" on klip_likes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notifications" on notifications for select using (user_id = auth.uid());
-- Admin/service writes go through the service role key from server actions.
