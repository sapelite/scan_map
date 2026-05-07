import { NextRequest, NextResponse } from 'next/server';
import { setStatus } from '@/lib/database';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { currentStatus } = await req.json();
    const nextStatus = await setStatus(id, currentStatus);
    return NextResponse.json({ nextStatus });
  } catch (error) {
    console.error("Status Update API Error:", error);
    return NextResponse.json({ error: "STATUS_SYNC_FAILURE" }, { status: 500 });
  }
}
