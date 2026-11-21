let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const secrets = JSON.parse(raw);
if (!Array.isArray(secrets) || !secrets.some((s) => s.name === "ADMIN_TOKEN"))
  throw Error(
    "Configure ADMIN_TOKEN in the existing Worker before releasing the reservations workspace",
  );
console.log("Protected workspace access is configured.");
