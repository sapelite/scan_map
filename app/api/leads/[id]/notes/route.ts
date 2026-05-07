import { NextRequest, NextResponse } from 'next/server';
import { updateNotes } from '@/lib/database';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { notes } = await req.json();
    await updateNotes(id, typeof notes === 'string' ? notes : '');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Notes Update API Error:", error);
    return NextResponse.json({ error: "NOTES_SYNC_FAILURE" }, { status: 500 });
  }
}
