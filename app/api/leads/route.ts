import { NextResponse } from 'next/server';
import { getLeads } from '@/lib/database';

export async function GET() {
  try {
    const leads = await getLeads();
    return NextResponse.json(leads || []);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}