# Kabootar Talk

One letter a day, carried by a pigeon that actually has to fly there.

Toronto to Hyderabad is 12,863 km. A letter takes about a day, because that is
how far it is. You can watch the bird cross the Arctic on a globe while it goes,
see it stop for water in Kyzylorda, and see it fly through the night over the
Kazakh steppe — but you cannot read a word until it lands.

The constraint is the whole point. When you get one letter a day, you write a
letter, not a message.

Everything is end-to-end encrypted. The server stores ciphertext and a delivery
time, and nothing else — no name, no email, no password, no location, no
message text.

---

## The idea

| | |
|---|---|
| **The birds** | A nest gets two kabootars, one at each end. They are objects, not a currency: you send one, she is *there* now, and she comes back when your partner writes to you with her. |
| **Pacing** | There is no quota and no timer. If both birds are at her end of the world, you cannot write, because there is nothing to write with. That is the whole mechanism. |
| **Care** | She gets tired, hungry and low. Feed her, make a fuss of her, let her sleep. A bird in poor spirits genuinely flies slower, and one who has been ignored for two days will refuse to go at all. |
| **Hurrying** | You can push her mid-flight. She arrives sooner and arrives wrecked, and she is not going anywhere else today. Three times is her limit. |
| **The flight** | A real great-circle route with rest stops, weather, headwinds, storms and night flying — shaped by her own traits, computed on your device, deterministic, so both of you watch the same bird do the same things. |
| **Pairing** | Six words, given to one person, used once. There is no directory and no way to be written to unasked. |

## Security

The honest version, including the parts that are not perfect.

### What the server knows

Everything in the database is a public key, a ciphertext it has no key for, or a
timestamp. Read [`src/lib/db/schema.sql`](src/lib/db/schema.sql) — it is written
to be read as the answer to "what would a leak expose?".

A full database dump tells an attacker that two opaque ids wrote to each other,
and roughly when. That is the metadata floor for any system that delivers
anything. It does not contain a single letter, name, or location.

### How it works

- **Identity** is an Ed25519 + X25519 keypair derived from a 12-word BIP39
  phrase. No accounts, no passwords, no reset flow. Sign-in is a signature over
  a server nonce, so there is no credential to phish or leak.
- **Message keys** come from [X3DH](https://signal.org/docs/specifications/x3dh/)
  — the same key agreement Signal uses — with a signed prekey and a pool of
  one-time prekeys, so letters can be written while the other person is asleep.
  The signed prekey is replaced weekly, which bounds how much a single
  compromised secret could ever expose; the previous one is kept so letters
  already in the air still open when they land.
- **Forward secrecy in transit** is real: each letter uses a one-time prekey
  that is destroyed after the letter is opened, so the copy the server carried
  can never be opened again by anyone, including you. Letters you choose to
  keep are re-sealed under a key derived from your phrase (see the archive,
  below), which is a deliberate trade and the one place this weakens.
- **Encryption** is XChaCha20-Poly1305. Every letter is sealed twice: a
  *manifest* (the route) released immediately so you can watch the pigeon, and
  a *body* the server refuses to hand over before the arrival time.
- **The delivery time is authenticated** inside both ciphertexts. A server that
  tries to deliver a letter early does not get a readable letter out the other
  side — it gets a decryption failure the app reports as tampering.
- **Keys at rest** are wrapped by a WebAuthn PRF passkey (the phone's secure
  element) or, as a fallback, Argon2id over a PIN.
- **Primitives** are [noble](https://paulmillr.com/noble/) — audited, minimal,
  no WASM. All crypto is in [`src/lib/crypto/`](src/lib/crypto/), about 600
  lines, meant to be read.
- **The browser is locked down**: `connect-src 'self'` means an injected script
  has nowhere to send anything — no third-party origin, no beacon, no image
  ping, no form post. No `eval`, no external script origin, no framing, and no
  `dangerouslySetInnerHTML` anywhere in the codebase.

### Verify each other

A malicious server could hand each of you keys it controls and sit in the
middle. Nothing in the protocol stops that — the only thing that does is the
two of you comparing **safety words** somewhere the server cannot reach.

Eight words, shown when you pair and any time after. Read them to each other
once, on a call you already trust. It takes ten seconds and it is the single
most valuable thing a user of this app can do.

### What this does not do

- **Not audited.** It is a careful implementation of well-understood
  primitives by someone who read the specs, not a reviewed cryptosystem. Judge
  it accordingly.
- **The archive is only as secret as your phrase.** A letter you have read is
  re-sealed under a key derived from your twelve words and mirrored to the
  server, so it survives a cleared browser and follows you to a new device
  without anything being transferred between them. The server still cannot
  read a byte of it. But somebody holding your phrase *and* a database dump
  could read your history, which the transport alone would not have allowed.
  Durability was worth more here than that guarantee.
- **Metadata is not hidden.** The server sees which nests exist and when
  letters move. Hiding that needs mixnets, and this is a letter app for two
  people.
- **No attachments.** Text only, which suits letters.
- **Erasing is local.** "Use a different phrase" drops this device's whole
  store — the vault, the prekey secrets and the decrypted letters. It does not
  reach the server, which still holds your kept letters, sealed. Signing in
  again with the same phrase brings them back; there is no way to delete them
  from the server yet.
- **Two numbers are trusted to the client.** The server never learns where
  either of you is, so it cannot check how long a flight should take or how
  much it should tire a bird. It enforces absolute bounds on both instead, and
  the recipient's device verifies them properly against the real distance. The
  worst a modified client achieves is a faster bird in its own nest, which both
  people consented to.
- **The CSP allows inline scripts.** The stronger form is a per-request nonce,
  but every page here is a static shell served from a CDN, so there is no
  request at render time to mint one. The choice was a nonce plus a server
  round-trip on every page load, or static delivery with inline allowed. For
  two people on opposite sides of the planet, the CDN won. Everything else in
  the policy is strict, and the containment is described above.

---

## Running it

### Locally

```bash
npm install
cp .env.example .env.local        # point DATABASE_URL at any Postgres
npm run db:push                   # create the schema
npm run dev
```

No Postgres to hand:

```bash
PGPW=$(openssl rand -hex 16)
docker run -d --name kabootar-db \
  -e POSTGRES_PASSWORD="$PGPW" -e POSTGRES_DB=kabootar \
  -p 5432:5432 postgres:17
echo "postgresql://postgres:$PGPW@localhost:5432/kabootar"   # goes in .env.local
```

Open <http://localhost:3000>. To look at the flight simulation without setting
up an account, <http://localhost:3000/preview> renders a full Toronto →
Hyderabad journey with a scrubber.

### Deploying

The app runs on Vercel with Neon Postgres:

1. Fork, then import the repo on Vercel.
2. Add Neon from the Vercel Marketplace — it sets `DATABASE_URL` for you.
3. Run `npm run db:push` once with that `DATABASE_URL`.

It fits comfortably in the free tiers for two people, because a pigeon in flight
costs the server nothing: the whole simulation runs on your device, and the
server is touched twice per letter.

### Commands

```bash
npm run dev         # development server
npm run build       # production build
npm test            # crypto and flight-simulation tests (offline, no database)
npm run typecheck   # tsc
npm run db:push     # apply schema.sql (idempotent)
```

### The end-to-end test

There is a second suite that runs the entire protocol against a live server and
a real database: two identities created from scratch, paired with a real code,
approved, and a real encrypted letter sent and fetched back. It is what proves
the delivery gate actually withholds a letter, rather than just that the unit
tests agree with themselves.

```bash
npm run build && npm start                   # in one terminal
KABOOTAR_E2E=http://localhost:3000 npm test  # in another
```

Rate limits are per-IP and will trip if you run it repeatedly. They can be
raised for testing — or permanently, if you are self-hosting for two people who
share a home connection and one router:

```bash
KABOOTAR_LIMIT_REGISTER=500 KABOOTAR_LIMIT_AUTH=500 KABOOTAR_LIMIT_REDEEM=500
```

---

## The kabootar

She is the part of this that makes the waiting bearable, so she is built to be
worth waiting with.

Every bird hatches with two traits drawn from her id, and they are not
decoration — a **Curious** bird really does come down more often and take
longer; a **Swift** one really does arrive sooner; a **Stormheart** meets less
weather. You learn your birds over weeks.

She runs on three vitals that pull on each other:

- **Energy** — a 12,863 km crossing nearly empties her, and she will not go out
  again until she has rested.
- **Fed** — she gets hungry on her own, with nothing running. A hungry bird
  loses heart.
- **Spirits** — dragged down by hunger, exhaustion and being ignored; lifted by
  grain and attention. Below a floor she simply refuses to fly, and you have to
  win her round.

None of it ticks on a schedule. Every value drifts continuously from the moment
it was last written, so she gets hungry whether or not anything is running, and
reading her at any instant gives the truth for that instant. All of it is
covered by tests — `src/lib/pigeon/life.test.ts` is the longest test file in
the repository, which is the right way round for the part that has to feel
alive.

## Kabootars of the world

An opt-in map of the cities people send from.

This is the only thing in the app that tells the server anything about where
anybody is, and it is off unless you switch it on. What it shares is a city
name from the bundled list — never a coordinate, never your name, never a
letter, never a time anything moved. A city appears only once several people
have chosen it, so nobody is ever the only dot on the map.

It draws as a single `THREE.Points` with one shader, so the entire world costs
one draw call however many cities are on it.

## How the flight works

`3 hours + distance / 600 km/h`, which puts Toronto → Hyderabad at 24.4 hours.
Tunable in [`FLIGHT_CONFIG`](src/lib/flight/schedule.ts).

From that, a full itinerary is built deterministically from the letter's id:
rest stops nudged onto land, weather rolled per leg, night flying worked out
from the real solar hour at the bird's longitude. Every leg is a state with its
own copy and its own animation — wing rate, bob, bank angle.

```
+  0.0h   1.3h  flying   launch          Ottawa
+  2.6h   2.4h  flying   storm           Davis Strait
+  5.1h   1.0h  resting  huddling        Greenland Ice Sheet
+  7.8h   1.1h  resting  ship            Scoresby Sound
+ 10.8h   1.0h  resting  perched         Murmansk
+ 14.7h   1.9h  flying   storm           Chelyabinsk
+ 20.7h   1.8h  resting  foraging        Islamabad
+ 23.6h   0.8h  flying   final-approach  Nagpur
```

Place names come from a bundled landmark set, never a geocoding API — looking
up the route online would leak both locations to a third party and defeat the
point of encrypting them.

The globe uses real Natural Earth coastlines and borders, bundled via
`world-atlas` — about 100 KB, no map tiles and no network request. They are
painted once into a single equirectangular texture rather than drawn as
geometry, which keeps the whole scene to roughly 24 draw calls.

Over it sits a real day/night terminator computed from the sun's actual
position, so you can watch the bird fly into darkness.

The scene does not run through React. React renders it once; every frame after
that is imperative work on objects that already exist, and nothing in the
animation loop allocates. The panel of numbers underneath updates every few
seconds, because "4,891 km flown" changing sixty times a second is unreadable
and a waste of a battery.

### About cheating

The simulation runs on your device, so you can wind your clock forward. It will
not help — the body ciphertext is not sent before the arrival time, and the
arrival time is authenticated inside the ciphertext, so it cannot be edited
either.

The app notices anyway, and the pigeon has opinions about it.

---

## Layout

```
src/lib/crypto/      identity, X3DH, the letter envelope, pairing codes
src/lib/flight/      great-circle geometry, itineraries, pigeon states
src/lib/db/          schema.sql and every query in the app, in one file
src/lib/server/      sessions, limits, validation
src/lib/client/      vault, prekey store, local archive, app state
src/components/globe globe, procedural pigeon
```

Two rules worth keeping if you fork it: all SQL stays in `queries.ts`, and all
primitives stay in `crypto/primitives.ts`. Both files exist so that reviewing
the security of this app means reading a short, specific list of things.

## Licence

MIT.
