export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { preferSupabaseIpv4 } = await import("./lib/node/preferSupabaseIpv4");
  preferSupabaseIpv4();
}
