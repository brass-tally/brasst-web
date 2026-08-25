import { useState } from "react";
import { MessageCircle, X } from "lucide-react";

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
        className="fixed bottom-6 right-6 p-3 bg-brass text-bg rounded-full shadow-brass-lg hover:shadow-brass-lg hover:scale-110 transition-all duration-200 z-40"
        title="Send feedback"
      >
        <MessageCircle size={20} />
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-surface w-full sm:w-full max-w-sm rounded-t-2xl sm:rounded-2xl border border-line p-6 animate-slide-up">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-serif text-text">Help us improve</h3>
              <button
                onClick={() => setOpen(false)}
                className="p-1 hover:bg-surface2 rounded-lg transition-colors"
              >
                <X size={20} className="text-muted" />
              </button>
            </div>

            {submitted ? (
              <div className="py-8 text-center animate-fade-in">
                <p className="text-brass font-semibold mb-2">Thank you!</p>
                <p className="text-sm text-muted">
                  Your feedback helps us build BrassTally better.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-mono text-faint mb-2">
                    Type
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-surface2 border border-line rounded-lg text-text text-sm focus:outline-none focus:border-brass focus:ring-1 focus:ring-brass"
                  >
                    <option value="bug">Bug report</option>
                    <option value="feature">Feature request</option>
                    <option value="improvement">Improvement</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-mono text-faint mb-2">
                    Your message
                  </label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us what's on your mind..."
                    className="w-full px-3 py-2 bg-surface2 border border-line rounded-lg text-text text-sm focus:outline-none focus:border-brass focus:ring-1 focus:ring-brass resize-none h-24"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!message.trim() || loading}
                  className="w-full px-4 py-2 bg-brass text-bg font-semibold rounded-lg hover:shadow-brass-lg transition-all disabled:opacity-50 disabled:cursor-default"
                >
                  {loading ? "Sending..." : "Send feedback"}
                </button>

                <p className="text-xs text-faint text-center">
                  We read every message. Thanks for helping us build better!
                </p>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
