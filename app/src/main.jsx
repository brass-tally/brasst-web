import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

/* Tell the launch mark it can go.
   Two frames after render, not one: the first frame is when React has written
   the DOM, the second is when the browser has actually painted it. Dismissing
   on the first leaves a gap where the splash has faded and the skeleton has not
   arrived, which is the flicker this animation exists to prevent.

   The dismissal is idempotent and the page has its own timeout, so if this
   never runs the mark still leaves. */
requestAnimationFrame(() => {
  requestAnimationFrame(() => window.__btLaunched?.());
});
