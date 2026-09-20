-- Kabootar Talk schema.
--
-- Read this file as the honest answer to "what could a database leak expose?"
-- Every column here is one of three things: a public key, a ciphertext the
-- server has no key for, or a timestamp. There is no name, no email, no phone
-- number, no password hash, no message text and no location anywhere in it.
--
-- An attacker who walks off with a full dump learns that some opaque ids wrote
-- to each other, and roughly when. That is the metadata floor for a system
-- that has to deliver anything at all.

create table if not exists users (
  -- base32 of a hash of the signing key. The server derives this rather than
  -- accepting it, so nobody can claim an id that is not theirs.
  id            text primary key,
  signing_key   text        not null,
  identity_key  text        not null,
  created_at    timestamptz not null default now(),

  -- The highest one-time prekey id ever issued to this account.
  --
  -- Kept separately from the prekeys themselves because used ones are pruned,
  -- and the id must never be handed out twice: a letter's header names the
  -- prekey it was sealed against, and the device maps that id to a secret. Let
  -- an id come round again and the new secret overwrites the old one, quietly
  -- making every letter that used it unopenable.
  prekey_high_water integer not null default 0
);

-- Medium-term prekey, signed by the identity key and rotated periodically.
create table if not exists signed_prekeys (
  user_id     text        not null references users(id) on delete cascade,
  id          integer     not null,
  public_key  text        not null,
  signature   text        not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- One per letter, deleted on use. This is what gives forward secrecy: once a
-- prekey is gone, the key that encrypted that letter cannot be rebuilt by
-- anyone, including someone who later seizes both phones and the database.
create table if not exists one_time_prekeys (
  user_id     text        not null references users(id) on delete cascade,
  id          integer     not null,
  public_key  text        not null,
  claimed_at  timestamptz,
  primary key (user_id, id)
);

create index if not exists one_time_prekeys_unclaimed
  on one_time_prekeys (user_id) where claimed_at is null;

-- For pruning used ones without scanning the whole table.
create index if not exists one_time_prekeys_claimed
  on one_time_prekeys (claimed_at) where claimed_at is not null;

-- Sign-in is a signature over a nonce, so there is no password to steal.
create table if not exists auth_challenges (
  nonce       bytea       primary key,
  user_id     text        not null,
  expires_at  timestamptz not null
);

create index if not exists auth_challenges_expiry on auth_challenges (expires_at);

-- Only the hash is stored, so a dump does not let anyone resume a session.
create table if not exists sessions (
  token_hash    bytea       primary key,
  user_id       text        not null references users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);

create index if not exists sessions_user on sessions (user_id);
create index if not exists sessions_expiry on sessions (expires_at);

-- A one-time pairing code. Hashed, single use, and short-lived: this is the
-- only way to reach somebody, which is what stops the app from ever having a
-- spam or unsolicited-contact problem.
create table if not exists invites (
  code_hash    bytea       primary key,
  inviter_id   text        not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  redeemed_by  text        references users(id) on delete cascade,
  redeemed_at  timestamptz
);

create index if not exists invites_inviter on invites (inviter_id);

-- A nest is a mutually confirmed pair. It becomes usable only after the
-- inviter approves the person who redeemed their code, so both sides have
-- explicitly agreed before a single letter can be sent.
create table if not exists nests (
  id            uuid        primary key default gen_random_uuid(),
  low_user_id   text        not null references users(id) on delete cascade,
  high_user_id  text        not null references users(id) on delete cascade,
  status        text        not null default 'pending',
  requested_by  text        not null references users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,

  -- Ordering the pair canonically makes the uniqueness constraint below work
  -- in both directions, so a pair can never be duplicated or self-paired.
  constraint nests_ordered check (low_user_id < high_user_id),
  constraint nests_status  check (status in ('pending', 'active', 'closed'))
);

create unique index if not exists nests_pair on nests (low_user_id, high_user_id);
create index if not exists nests_low  on nests (low_user_id);
create index if not exists nests_high on nests (high_user_id);

-- The birds.
--
-- A kabootar is a thing, not a quota. It is somewhere — with one of you, or in
-- the air between you — and that location is the whole pacing mechanism: you
-- can only write if a bird is standing on your side of the world. When both
-- are at her end, you wait. There is no counter that refills on a timer,
-- because there does not need to be.
--
-- A nest gets two, one at each end, and they shuttle.
create table if not exists pigeons (
  id            uuid        primary key default gen_random_uuid(),
  nest_id       uuid        not null references nests(id) on delete cascade,
  name          text        not null,
  hatched_at    timestamptz not null default now(),

  -- Who is holding her. Null exactly while she is in the air.
  holder_id     text        references users(id) on delete cascade,
  -- Set while flying: where she is going, and when she gets there.
  flying_to     text        references users(id) on delete cascade,
  departed_at   timestamptz,
  arrives_at    timestamptz,
  -- How many times she has been pushed to hurry on this flight.
  urges         integer     not null default 0,

  -- Her condition, stored with the moment it was true and brought up to date
  -- on read. Nothing has to be running for her to get hungry.
  stamina       integer     not null default 100,
  hunger        integer     not null default 0,
  spirits       integer     not null default 80,
  vitals_at     timestamptz not null default now(),

  -- Being looked after.
  fed_at        timestamptz,
  petted_at     timestamptz,
  pets_today    integer     not null default 0,
  pets_day_at   timestamptz,

  -- A life, accumulated.
  --
  -- Trips only. Distance is deliberately absent: the server never learns where
  -- either nest is, so it cannot know how far she flew, and storing a number
  -- the client supplied would hand over exactly the location hint the manifest
  -- encryption exists to withhold. Lifetime distance is added up on the device
  -- from letters it has decrypted.
  trips         integer     not null default 0,
  bond          integer     not null default 0,

  constraint pigeons_vitals check (
    stamina between 0 and 100 and hunger between 0 and 100 and spirits between 0 and 100
  ),
  constraint pigeons_bond  check (bond >= 0 and bond <= 100),
  constraint pigeons_urges check (urges >= 0 and urges <= 10),
  -- She is either held or flying, never both and never neither.
  constraint pigeons_located check (
    (holder_id is not null and flying_to is null)
    or (holder_id is null and flying_to is not null and arrives_at is not null)
  )
);

create index if not exists pigeons_nest on pigeons (nest_id);
create index if not exists pigeons_arriving on pigeons (arrives_at) where flying_to is not null;

-- A letter in flight.
--
-- `manifest` and `body` are separately sealed ciphertexts. The manifest is
-- served straight away so the recipient can watch the pigeon travel; the body
-- is withheld until arrives_at. Both authenticate the header, so the server
-- cannot move arrives_at earlier without destroying the letter.
create table if not exists letters (
  id           uuid        primary key default gen_random_uuid(),
  nest_id      uuid        not null references nests(id) on delete cascade,
  sender_id    text        not null references users(id) on delete cascade,
  -- Which bird is carrying it.
  pigeon_id    uuid        references pigeons(id) on delete set null,
  header       jsonb       not null,
  manifest     text        not null,
  body         text        not null,
  mode         text        not null default 'normal',
  departed_at  timestamptz not null,
  arrives_at   timestamptz not null,
  opened_at    timestamptz,
  created_at   timestamptz not null default now(),

  constraint letters_mode  check (mode in ('normal', 'express')),
  constraint letters_order check (arrives_at > departed_at)
);

create index if not exists letters_nest on letters (nest_id, departed_at desc);
create index if not exists letters_arrival on letters (arrives_at);

-- Coarse abuse control for the few endpoints that are reachable before a
-- session exists. Pigeon balances handle the rest.
create table if not exists rate_limits (
  bucket        text        primary key,
  hits          integer     not null default 0,
  window_start  timestamptz not null default now()
);

create index if not exists rate_limits_window on rate_limits (window_start);

-- The world map: where kabootars are being sent from, in aggregate only.
--
-- Strictly opt-in, and deliberately lossy. A row is a bundled city name and a
-- running count — never a user, never a letter, never a time a letter moved.
-- Cities are only shown once several people have chosen them, so nobody is
-- ever the only dot on the map. This is the one place the server learns
-- anything about location at all, and it learns it only because somebody
-- decided to tell it.
create table if not exists world_beacons (
  city        text        primary key,
  senders     integer     not null default 0,
  updated_at  timestamptz not null default now(),

  constraint world_beacons_sane check (senders >= 0)
);

-- Who has joined the map, and deliberately not where.
--
-- This table is what makes the threshold mean anything. Without it a single
-- account could add itself to one city three times and push it over the line
-- on its own, so a city claiming three senders might be one person — which is
-- precisely the guarantee the threshold is supposed to provide.
--
-- It records only that an account has joined, once. There is no city column
-- here and no user column on world_beacons, so the two facts are never stored
-- together and nobody's location can be recovered by joining them.
create table if not exists world_members (
  user_id    text        primary key references users(id) on delete cascade,
  joined_at  timestamptz not null default now()
);

-- Your own letters, kept where any of your devices can reach them.
--
-- The transport gives a letter per-letter forward secrecy: the one-time prekey
-- that opened it is destroyed on read, and the copy in `letters` becomes
-- permanently unreadable. That is the right guarantee for a message in flight,
-- and the wrong one for a letter you want to keep, because it made the reading
-- device the only place the words existed. Clearing a browser lost them.
--
-- So an opened letter is re-sealed under a key derived from the owner's
-- recovery phrase and stored here. Every device restored from those twelve
-- words derives the identical key, which is what makes the history portable
-- without the server ever holding one.
--
-- What a leak exposes: an opaque account id, a letter id, and a blob this
-- database has no key for. Reading it needs the phrase as well, which is the
-- trade this table makes deliberately — durability in exchange for the older
-- promise that a seized database could never be opened even with the phrase.
--
-- No foreign key to letters(id) on purpose: this copy must outlive anything
-- that might remove the row it came from.
create table if not exists archive_entries (
  user_id     text        not null references users(id) on delete cascade,
  letter_id   uuid        not null,
  blob        text        not null,
  updated_at  timestamptz not null default now(),

  primary key (user_id, letter_id)
);

create index if not exists archive_entries_owner
  on archive_entries (user_id, updated_at desc);

-- --- columns added after a table first shipped ------------------------------
--
-- `create table if not exists` silently does nothing when the table is already
-- there, so a column added later never reaches a database that predates it.
-- These alters are idempotent and run on every deploy, which is what makes a
-- schema file safe to apply to an existing coop as well as a fresh one.

alter table users
  add column if not exists prekey_high_water integer not null default 0;

-- Set by a recipient who cannot open a letter, because the device it was
-- sealed for no longer holds the key — a cleared browser, a lost phone. The
-- sender still has the words in their own archive, so the letter can be
-- sealed again for the keys the recipient has now. It is a request for a
-- repair, not a new letter: the pigeon has already made the trip.
alter table letters
  add column if not exists reseal_requested_at timestamptz;
