import { NextResponse, type NextRequest } from "next/server";

function isE2eRouteEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.E2E_TEST_MODE === "1";
}

function safeRedirect(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/stores";
}

export async function GET(request: NextRequest) {
  if (!isE2eRouteEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const configuredSecret = process.env.E2E_TEST_SECRET?.trim();
  if (!configuredSecret || request.headers.get("x-e2e-secret") !== configuredSecret) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!process.env.E2E_TEST_USER_ID) {
    return NextResponse.json({ error: "E2E auth is not configured" }, { status: 500 });
  }

  const response = NextResponse.redirect(
    new URL(safeRedirect(request.nextUrl.searchParams.get("redirect")), request.url),
  );
  response.cookies.set("__fw_e2e_session", configuredSecret, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 3600,
  });
  return response;
}
