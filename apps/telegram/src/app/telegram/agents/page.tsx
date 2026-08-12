"use client";

import { Bot } from "lucide-react";

export default function AgentsPage() {
  return (
    <main className="min-h-screen text-white font-sans selection:bg-teal-500/30 overflow-hidden relative">
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, #1c1f26 0%, #111318 35%, #0a0b0d 100%)"
        }}
      />

      <div className="relative z-10 px-6 pt-6 pb-20 max-w-md mx-auto flex flex-col min-h-screen">
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
            <Bot className="w-8 h-8 text-zinc-500" />
          </div>
          <h1 className="text-xl font-semibold text-white/90 mb-2">Agents</h1>
          <p className="text-zinc-500 text-sm text-center">
            Coming soon
          </p>
        </div>
      </div>
    </main>
  );
}
