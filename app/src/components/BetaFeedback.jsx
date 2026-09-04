import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { P } from "../ui/tokens";
import { Modal, ModalBody } from "../ui/Modal";
import { Btn } from "../ui/Btn";
import { Label, Select, Textarea } from "../ui/Field";

export function BetaFeedbackButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("bug");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;

    setLoading(true);
    try {
      // This would connect to your feedback API endpoint
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          message,
          url: window.location.href,
          timestamp: new Date().toISOString(),
        }),
      });

      if (response.ok) {
        setSubmitted(true);
        setMessage("");
        setTimeout(() => {
          setSubmitted(false);
          setOpen(false);
        }, 2000);
      }
    } catch (error) {
      console.error("Feedback submission failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 p-3 bg-brass text-onbrass rounded-full shadow-brass-lg hover:scale-110 transition-transform duration-200 z-40"
        title="Send feedback"
      >
        <MessageCircle size={20} />
      </button>

      {/* Modal — the shared chrome, so this dialog blurs its backdrop, traps
          focus, and closes on Escape like every other one in the app. */}
      {open && (
        <Modal onClose={() => setOpen(false)} size="sm" eyebrow="Beta" title="Help us improve">
          {submitted ? (
            <ModalBody className="py-10 text-center">
              <p style={{ color: P.brass }} className="font-semibold mb-2">Thank you</p>
              <p style={{ color: P.muted }} className="text-sm">
                Your feedback helps us build Brasstally better.
              </p>
            </ModalBody>
          ) : (
            <form onSubmit={handleSubmit}>
              <ModalBody className="space-y-4">
                <div>
                  <Label htmlFor="feedback-type">Type</Label>
                  <Select id="feedback-type" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="bug">Bug report</option>
                    <option value="feature">Feature request</option>
                    <option value="improvement">Improvement</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="feedback-message">Your message</Label>
                  <Textarea
                    id="feedback-message"
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us what's on your mind…"
                  />
                </div>
                <Btn type="submit" className="w-full" size="lg" loading={loading} disabled={!message.trim()}>
                  {loading ? "Sending…" : "Send feedback"}
                </Btn>
                <p style={{ color: P.faint }} className="text-xs text-center">
                  We read every message.
                </p>
              </ModalBody>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
