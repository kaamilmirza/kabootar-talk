import * as db from '@/lib/db/queries';
import { LIFE, release, statusOf } from '@/lib/pigeon/life';
import { viewOf } from '@/lib/server/flock';
import { FLIGHT_BOUNDS } from '@/lib/server/config';
import {
  assertSameOrigin,
  badRequest,
  forbidden,
  json,
  notFound,
  parseBody,
  route,
  tooMany,
} from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';
import { sendLetterSchema, uuid } from '@/lib/server/validation';

type Context = { params: Promise<{ id: string }> };

/** How far a client's idea of "now" may differ from the server's when sending. */
const DEPARTURE_TOLERANCE_MS = 120_000;

const HOUR_MS = 3_600_000;

export const GET = route(async (_request: Request, { params }: Context) => {
  const userId = await requireUserId();
  const nestId = uuid.parse((await params).id);

  const nest = await db.findNest(nestId, userId);
  if (!nest) throw notFound('No such nest.');

  const [letters, birds] = await Promise.all([db.listLetters(nestId), db.listPigeons(nestId)]);

  // So a letter can say which bird actually carried it, by name, rather than
  // inventing one from the letter's own seed.
  const names = new Map(birds.map((b) => [b.id, b.name]));

  return json({
    letters: letters.map((l) => ({
      id: l.id,
      senderId: l.sender_id,
      mine: l.sender_id === userId,
      pigeonId: l.pigeon_id,
      pigeonName: l.pigeon_id ? (names.get(l.pigeon_id) ?? null) : null,
      header: l.header,
      manifest: l.manifest,
      // Null until the pigeon lands. The gate is in SQL, not here.
      body: l.body,
      mode: l.mode,
      departedAt: l.departed_at.getTime(),
      arrivesAt: l.arrives_at.getTime(),
      openedAt: l.opened_at?.getTime() ?? null,
    })),
  });
});

/**
 * Release a kabootar.
 *
 * The server checks three things and understands none of the content:
 *
 *   1. That the nest is active, and you are in it.
 *   2. That the flight is plausibly timed. It cannot check the claimed time
 *      against the real distance, because it never learns either location —
 *      so it enforces absolute bounds, and the recipient's client separately
 *      verifies the time against the distance it decrypts.
 *   3. That you have a bird to spend.
 */
export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const userId = await requireUserId();
  const nestId = uuid.parse((await params).id);

  const nest = await db.findNest(nestId, userId);
  if (!nest) throw notFound('No such nest.');
  if (nest.status !== 'active') {
    throw forbidden('This nest is still waiting to be confirmed by both of you.');
  }

  const input = await parseBody(request, sendLetterSchema);
  const { header } = input;

  // The header is authenticated inside both ciphertexts, so these fields are
  // exactly what the recipient will verify against. Refusing a mismatch here
  // turns a confusing decryption failure into a clear error.
  if (header.nestId !== nestId) throw badRequest('Letter is addressed to a different nest.');
  if (header.senderId !== userId) throw badRequest('Letter is signed by somebody else.');

  const now = Date.now();
  if (Math.abs(header.departedAt - now) > DEPARTURE_TOLERANCE_MS) {
    throw badRequest('Your device clock is too far off to release a pigeon.');
  }

  const durationMs = header.arrivesAt - header.departedAt;
  const bounds = FLIGHT_BOUNDS[header.mode];
  if (durationMs < bounds.minHours * HOUR_MS || durationMs > bounds.maxHours * HOUR_MS) {
    throw badRequest('That flight time is not possible for a kabootar.');
  }

  // --- the bird ----------------------------------------------------------
  //
  // A letter is not sent by spending from a balance; it is tied to the leg of
  // a particular kabootar who is standing with you right now. If she is on the
  // other side of the world, or already carrying something, or too tired, or
  // sulking, there is nothing to send it with.
  await db.landArrivals(nestId);

  const row = await db.findPigeon(input.pigeonId, userId);
  if (!row) throw badRequest('No such kabootar.');
  if (row.nest_id !== nestId) throw badRequest('She belongs to a different nest.');

  const pigeon = db.toPigeonState(row, userId);
  const status = statusOf(pigeon, now);

  if (!status.canFly) {
    throw tooMany(
      {
        away: `${pigeon.name} is at the other end of the world. Wait for her to come back.`,
        flying: `${pigeon.name} is already carrying a letter.`,
        tired: `${pigeon.name} is too worn out to fly. She needs to rest.`,
        unwilling: `${pigeon.name} will not go. Feed her and make a fuss of her first.`,
      }[status.blockedBecause ?? 'tired'],
    );
  }

  // The server never learns the distance, so it cannot compute what the flight
  // costs her. The client does that and the server bounds it, exactly as it
  // bounds the flight time above.
  const vitals = release(pigeon, now, 0);
  const claimed = input.staminaAfter;
  const mostItCouldCost = status.stamina - LIFE.minFlightCost;

  if (claimed > mostItCouldCost) {
    throw badRequest('That flight would not tire her nearly enough.');
  }

  const partnerId = nest.low_user_id === userId ? nest.high_user_id : nest.low_user_id;

  const released = await db.releasePigeon({
    pigeonId: pigeon.id,
    holderId: userId,
    flyingTo: partnerId,
    departedAt: new Date(header.departedAt),
    arrivesAt: new Date(header.arrivesAt),
    vitals: { ...vitals, stamina: Math.max(0, claimed) },
  });

  if (!released) throw tooMany(`${pigeon.name} has already gone.`);

  const letter = await db.insertLetter({
    nestId,
    senderId: userId,
    pigeonId: pigeon.id,
    header,
    manifest: input.manifest,
    body: input.body,
    mode: header.mode,
    departedAt: new Date(header.departedAt),
    arrivesAt: new Date(header.arrivesAt),
  });

  const after = await db.findPigeon(pigeon.id, userId);

  return json(
    {
      id: letter?.id,
      arrivesAt: header.arrivesAt,
      pigeon: after ? viewOf(db.toPigeonState(after, userId), Date.now()) : null,
    },
    { status: 201 },
  );
});
