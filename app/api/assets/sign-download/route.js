import { NextResponse } from 'next/server';

// Never fall back to decoding an unverified JWT in this legacy endpoint.
export async function POST() {
  return NextResponse.json({ error: 'Server signing is retired. Use authenticated Storage downloads.' }, { status: 410 });
}
