const origin = process.argv[2];
if (!origin || !origin.startsWith("https://"))
  throw Error("An HTTPS deployment origin is required");
for (const [path, status] of [
  ["/", 200],
  ["/api/health", 200],
  ["/api/tours", 200],
  ["/api/admin/dashboard", 401],
  ["/api/trade/bookings", 401],
]) {
  const r = await fetch(new URL(path, origin), {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (r.status !== status)
    throw Error(`${path}: expected ${status}, received ${r.status}`);
  if (path.startsWith("/api/")) {
    const data = await r.json();
    if (path === "/api/tours" && !Array.isArray(data.tours))
      throw Error("Tours response is invalid");
  }
  console.log(`Verified ${path}: ${status}`);
}
