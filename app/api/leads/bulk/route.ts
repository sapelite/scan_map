import { NextRequest, NextResponse } from 'next/server';
import { bulkSetStatus, bulkDelete } from '@/lib/database';

export async function POST(req: NextRequest) {
  try {
    const { action, ids, status } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No targets specified' }, { status: 400 });
    }

    if (action === 'status') {
      const count = await bulkSetStatus(ids, status);
      return NextResponse.json({ success: true, count });
    }
    if (action === 'delete') {
      const count = await bulkDelete(ids);
      return NextResponse.json({ success: true, count });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Bulk API Error:', error);
    return NextResponse.json({ error: 'BULK_FAILURE' }, { status: 500 });
  }
}
