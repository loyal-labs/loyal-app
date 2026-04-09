import "~/src/lib/polyfills";
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import '~/assets/tailwind.css';

// Signal background that popup is open (prevents duplicate windows for dApp approvals)
browser.runtime.connect({ name: "popup" });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
