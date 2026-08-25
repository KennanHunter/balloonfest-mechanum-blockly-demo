import { RobotSim, type Env } from './RobotSim';

export { RobotSim };

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/health') {
      return withCors(
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return withCors(new Response('expected websocket', { status: 426 }));
      }
      const id = env.ROBOT.idFromName('default');
      const stub = env.ROBOT.get(id);
      // WS upgrade response — CORS headers don't apply.
      return stub.fetch(request);
    }

    // Static assets (SPA).
    const assetRes = await env.ASSETS.fetch(request);
    return withCors(assetRes);
  },
};
