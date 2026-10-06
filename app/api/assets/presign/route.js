import { NextResponse } from 'next/server';

// Static tablet builds use authenticated Supabase Storage with per-user RLS.
export async function POST() {
  return NextResponse.json({ error: 'Server signing is retired. Use authenticated Storage uploads.' }, { status: 410 });
}
