import { useState, type FormEvent } from "react";
export default function BookingMail({
  api,
  reference,
  suppliers,
}: {
  api: (path: string, body?: any) => Promise<any>;
  reference: string;
  suppliers: any[];
}) {
  const [messages, setMessages] = useState<any[]>([]);
  const [configured, setConfigured] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const d = await api("mail?reference=" + encodeURIComponent(reference));
    setMessages(d.messages);
    setConfigured(d.sendingConfigured);
  }
  async function act(id: string, command: string) {
    setBusy(true);
    try {
      await api("mail/" + id, { command });
      await load();
      setNotice(
        command === "send"
          ? "Email submitted to your email service."
          : "Message approved. Review the recipients before sending.",
      );
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function draft(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    try {
      await api("mail", { ...values, reference });
      await load();
      setNotice(
        "Draft saved. Review its recipients and text, then approve it.",
      );
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Supplier correspondence</h2>
      <p>
        Guest or operator copying follows the saved reservation permissions.
        Every draft, approval and sending result is recorded against this
        booking.
      </p>
      <button onClick={() => load().catch((e) => setNotice(String(e)))}>
        Load correspondence
      </button>
      <details>
        <summary>Prepare supplier email</summary>
        <form className="deskForm" onSubmit={draft}>
          <label>
            Supplier
            <select name="supplierId" required>
              <option value="">Choose supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Content type
            <select name="confidentiality">
              <option value="booking">Booking correspondence</option>
              <option value="trade">Confidential trade terms</option>
            </select>
          </label>
          <label>
            Subject
            <input name="subject" required maxLength={160} />
          </label>
          <label>
            Message
            <textarea name="body" required />
          </label>
          <button disabled={busy}>Save email draft</button>
        </form>
      </details>
      {messages.map((m) => {
        const r = JSON.parse(m.recipients_json);
        return (
          <article key={m.id}>
            <h3>{m.subject}</h3>
            <p>
              To: {r.to.join(", ")}
              <br />
              Copy: {r.cc.join(", ")}
              <br />
              Status: {m.state}
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>{m.body}</p>
            {m.state === "draft" && (
              <button disabled={busy} onClick={() => act(m.id, "approve")}>
                Approve message
              </button>
            )}
            {m.state === "approved" && (
              <button
                disabled={busy || !configured}
                onClick={() => act(m.id, "send")}
              >
                {configured
                  ? "Send approved email"
                  : "Email service not connected"}
              </button>
            )}
            {m.state === "unknown" && (
              <p>
                Check the email service for this message before preparing
                another: {m.id}
              </p>
            )}
          </article>
        );
      })}
      <p role="status">{notice}</p>
    </section>
  );
}
