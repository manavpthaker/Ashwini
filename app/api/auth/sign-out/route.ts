import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readAuthConfig } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const config = readAuthConfig();
  if (config.mode !== "supabase") {
    return Response.json(
      { error: "Supabase auth is not configured on this deployment." },
      { status: 501, headers: { "cache-control": "no-store" } },
    );
  }

  const cookieStore = await cookies();
  const response = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });

  const supabase = createServerClient(
    config.supabaseUrl as string,
    config.supabaseAnonKey as string,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  await supabase.auth.signOut();
  return response;
}
