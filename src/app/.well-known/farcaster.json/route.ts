export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function withValidProperties<T extends Record<string, unknown>>(properties: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(properties).filter(([_, value]) => (Array.isArray(value) ? value.length > 0 : value !== undefined)),
  ) as Partial<T>;
}

function env(key: string): string {
  // Bracket access prevents build-time env inlining.
  return process.env[key] ?? '';
}

export async function GET() {
  const url = env('NEXT_PUBLIC_URL') || 'https://basion.app';

  // Base / Farcaster clients read this endpoint for:
  // - domain ownership proof (accountAssociation)
  // - app identity + discovery fields (frame)
  //
  // IMPORTANT: Do not hand-edit/transform signatures. Paste the generated values as-is.
  const appMeta = withValidProperties({
    version: '1',
    name: 'Basion Tap',
    subtitle: 'Tap-to-earn on Base',
    description: 'Buy taps, tap onchain, earn points, climb the leaderboard.',
    screenshotUrls: [`${url}/favicon.png`],
    iconUrl: `${url}/favicon.png`,
    splashImageUrl: `${url}/favicon.png`,
    splashBackgroundColor: '#000000',
    homeUrl: url,
    webhookUrl: `${url}/api/webhook`,
    primaryCategory: 'games',
    tags: ['tap', 'game', 'base', 'onchain', 'basion'],
    heroImageUrl: `${url}/favicon.png`,
    tagline: 'Tap. Earn. Repeat.',
    ogTitle: 'Basion Tap',
    ogDescription: 'Tap-to-earn game on Base.',
    ogImageUrl: `${url}/favicon.png`,
    // Development: prevent indexing until signature is valid and assets are final.
    noindex: true,
  });

  const body = {
    accountAssociation: {
      header: env('FARCASTER_HEADER'),
      payload: env('FARCASTER_PAYLOAD'),
      signature: env('FARCASTER_SIGNATURE'),
    },
    // Docs/clients are in transition: some expect `miniapp`, some `frame`.
    // Returning both keeps Base Preview + discovery happy.
    miniapp: appMeta,
    frame: appMeta,
  };

  return Response.json(body, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

