import { NextResponse } from 'next/server';

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];

function ensureEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function getBearerToken(req) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

function decodeJwtSubject(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return decoded?.sub || decoded?.user_id || null;
  } catch (error) {
    console.error('Failed to decode JWT', error);
    return null;
  }
}

async function fetchSupabaseUser(token) {
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_ANON_KEY,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to verify Supabase token: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  return body?.user || null;
}

async function createSignedUploadUrl(bucket, objectPath, contentType) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        objectName: objectPath,
        expiresIn: 60 * 5, // 5 minutes
        contentType,
      }),
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to sign upload URL: ${response.status} ${response.statusText} ${errorText}`);
  }

  const body = await response.json();
  return body;
}

async function insertAssetMetadata(metadata) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/assets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(metadata),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to persist asset metadata: ${response.status} ${response.statusText} ${errorText}`);
  }

  const body = await response.json();
  return Array.isArray(body) ? body[0] : body;
}

export async function POST(req) {
  try {
    ensureEnv();

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    let user = null;
    try {
      user = await fetchSupabaseUser(token);
    } catch (error) {
      console.error('Supabase auth validation failed', error);
    }

    const userId = user?.id || decodeJwtSubject(token);
    if (!userId) {
      return NextResponse.json({ error: 'Invalid Supabase JWT' }, { status: 401 });
    }

    const { filename, contentType, sizeBytes, assetKey } = await req.json();
    if (!filename) {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 });
    }

    const sanitizedName = filename.replace(/[^\w.\-]/g, '_');
    const safeAssetKey = assetKey ? String(assetKey).replace(/[^\w.\-]/g, '_') : null;
    const objectPath = safeAssetKey
      ? `${userId}/${safeAssetKey}`
      : `${userId}/${Date.now()}-${sanitizedName}`;

    const signed = await createSignedUploadUrl('assets', objectPath, contentType);

    const metadata = await insertAssetMetadata({
      path: signed.path || objectPath,
      filename: sanitizedName,
      user_id: userId,
      content_type: contentType || null,
      size_bytes: sizeBytes || null,
      upload_token: signed.token || null,
      status: 'pending_upload',
    });

    return NextResponse.json(
      {
        uploadUrl: signed.signedUrl,
        token: signed.token,
        path: signed.path || objectPath,
        metadata,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to create presigned upload URL', error);
    return NextResponse.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
}
