import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { queryUnsafe } from '@/lib/db';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const alertId = parseInt(id, 10);

  if (isNaN(alertId)) {
    return NextResponse.json({ error: 'Invalid alert id' }, { status: 400 });
  }

  try {
    const updated = await queryUnsafe<{ id: number }>(
      `UPDATE alerts SET is_active = FALSE
       WHERE id = $1
         AND user_id = (SELECT id FROM users WHERE email = $2)
         AND is_active = TRUE
       RETURNING id`,
      [alertId, session.user.email],
    );

    if (!updated[0]) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { deleted: true, id: alertId } });
  } catch (err) {
    console.error('[alerts DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}