export const runtime = 'nodejs';

// Webhook endpoint for Mini App events.
// Even if you don't use notifications yet, having this avoids metadata warnings
// and keeps the manifest schema satisfied.
export async function POST() {
  return new Response('ok', { status: 200 });
}

export async function GET() {
  return new Response('ok', { status: 200 });
}

