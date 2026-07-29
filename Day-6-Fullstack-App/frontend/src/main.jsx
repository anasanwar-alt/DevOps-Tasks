import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// The entry point. It finds the empty <div id="root"> in index.html and tells
// React to take over that element. Everything else on the page is built by React.
//
// StrictMode is a development-only wrapper: it deliberately runs certain code
// twice to surface bugs. It disappears in the production build, so if you see
// two "load" requests in the dev server's console, that is why — not a bug.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
