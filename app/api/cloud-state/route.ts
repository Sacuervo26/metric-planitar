import { get, put } from "@vercel/blob";
import type { RemoteDashboardState } from "@/lib/store/remote-dashboard-state";

export const dynamic = "force-dynamic";

const LATEST_STATE_PATH = "metric-planitar/state/latest-state.json";

function isBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readLatestState(): Promise<RemoteDashboardState | null> {
  try {
    const blob = await get(LATEST_STATE_PATH, {
      access: "private",
    });
    if (!blob) return null;

    const text = await new Response(blob.stream).text();
    if (!text) return null;

    return JSON.parse(text) as RemoteDashboardState;
  } catch {
    return null;
  }
}

export async function GET() {
  if (!isBlobConfigured()) {
    return Response.json({
      configured: false,
      state: null,
    });
  }

  const state = await readLatestState();
  return Response.json({
    configured: true,
    state,
  });
}

export async function POST(request: Request) {
  if (!isBlobConfigured()) {
    return Response.json(
      {
        configured: false,
        state: null,
      },
      { status: 200 }
    );
  }

  const payload = (await request.json()) as RemoteDashboardState;
  const serialized = JSON.stringify(payload);

  await put(
    LATEST_STATE_PATH,
    new Blob([serialized], { type: "application/json" }),
    {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      multipart: true,
    }
  );

  return Response.json({
    configured: true,
    state: payload,
  });
}
