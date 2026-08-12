import "~/src/lib/polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import "~/assets/tailwind.css";
import App from "./App";

// Signal background that sidebar is open (clears badge hint)
browser.runtime.connect({ name: "sidepanel" });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
