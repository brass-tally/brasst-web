import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* A stamp, so anyone can tell which build is live.

   Several rounds were spent on "it is still broken" against a build that did
   not yet contain the fix, on both sides. Guessing from behaviour is slow and
   wrong; a visible id ends it. */
const BUILD_ID = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react()],
  base: "/app/",
});
