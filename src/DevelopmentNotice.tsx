import { useEffect, useState } from "react";
export default function DevelopmentNotice() {
  const [demo, setDemo] = useState<{ accessCode: string } | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fetch("/api/development-runtime")
      .then((r) => r.json())
      .then((d) => {
        if (d.demo) setDemo(d);
      })
      .catch(() => {});
  }, []);
  return demo ? (
    <aside className="demoNotice" role="status">
      <strong>Demonstration workspace</strong> · Disposable local records. No
      real bookings or emails. Admin demo access code:{" "}
      <code>{demo.accessCode}</code>
    </aside>
  ) : null;
}
