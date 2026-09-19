import * as db from '@/lib/db/queries';
import { json, route } from '@/lib/server/http';
import { requireUserId } from '@/lib/server/session';

/**
 * The nests you are part of.
 *
 * A nest is only usable once both people have agreed to it, so `pending`
 * entries appear here as an invitation to approve or ignore — never as a
 * conversation somebody else has already started with you.
 */
export const GET = route(async () => {
  const userId = await requireUserId();
  const nests = await db.listNests(userId);

  return json({
    nests: nests.map((n) => {
      const partnerId = n.low_user_id === userId ? n.high_user_id : n.low_user_id;
      return {
        id: n.id,
        status: n.status,
        partner: {
          id: partnerId,
          signingKey: n.partner_signing_key,
          identityKey: n.partner_identity_key,
        },
        /** True when this nest is waiting on *you* to approve it. */
        awaitingYou: n.status === 'pending' && n.requested_by !== userId,
        createdAt: n.created_at.getTime(),
        confirmedAt: n.confirmed_at?.getTime() ?? null,
      };
    }),
  });
});
