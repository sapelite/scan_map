import { NextRequest, NextResponse } from 'next/server';
import { deleteLead } from '@/lib/database';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> } // Note: params is a Promise now
) {
  try {
    const { id } = await params;
    await deleteLead(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "PURGE_FAILURE" }, { status: 500 });
  }
}