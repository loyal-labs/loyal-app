// components/topics-sidebar.tsx
"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area"; // shadcn/ui

type Topic = { id: string; title: string; updatedAt: string };

type TopicsSidebarProps = {
  topics: Topic[];
  onNewChat?: () => void;
};

function QRCodeMockup() {
  return (
    <svg
      aria-labelledby="qr-code-title"
      className="h-32 w-32"
      fill="none"
      role="img"
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id="qr-code-title">QR code to connect with Loyal miniapp</title>
      {/* Corner squares */}
      <rect fill="currentColor" height="25" width="25" x="5" y="5" />
      <rect fill="white" height="15" width="15" x="10" y="10" />
      <rect fill="currentColor" height="9" width="9" x="13" y="13" />

      <rect fill="currentColor" height="25" width="25" x="70" y="5" />
      <rect fill="white" height="15" width="15" x="75" y="10" />
      <rect fill="currentColor" height="9" width="9" x="78" y="13" />

      <rect fill="currentColor" height="25" width="25" x="5" y="70" />
      <rect fill="white" height="15" width="15" x="10" y="75" />
      <rect fill="currentColor" height="9" width="9" x="13" y="78" />

      {/* Random pattern */}
      <rect fill="currentColor" height="5" width="5" x="35" y="5" />
      <rect fill="currentColor" height="5" width="5" x="45" y="5" />
      <rect fill="currentColor" height="5" width="5" x="55" y="5" />
      <rect fill="currentColor" height="5" width="5" x="35" y="15" />
      <rect fill="currentColor" height="5" width="5" x="50" y="15" />
      <rect fill="currentColor" height="5" width="5" x="60" y="15" />
      <rect fill="currentColor" height="5" width="5" x="40" y="25" />
      <rect fill="currentColor" height="5" width="5" x="55" y="25" />

      <rect fill="currentColor" height="5" width="5" x="5" y="35" />
      <rect fill="currentColor" height="5" width="5" x="15" y="35" />
      <rect fill="currentColor" height="5" width="5" x="25" y="40" />
      <rect fill="currentColor" height="5" width="5" x="5" y="45" />
      <rect fill="currentColor" height="5" width="5" x="20" y="50" />
      <rect fill="currentColor" height="5" width="5" x="5" y="55" />
      <rect fill="currentColor" height="5" width="5" x="15" y="60" />
      <rect fill="currentColor" height="5" width="5" x="25" y="55" />

      {/* Center pattern */}
      <rect fill="currentColor" height="30" width="30" x="35" y="35" />
      <rect fill="white" height="20" width="20" x="40" y="40" />
      <rect fill="currentColor" height="10" width="10" x="45" y="45" />

      {/* Right side pattern */}
      <rect fill="currentColor" height="5" width="5" x="70" y="35" />
      <rect fill="currentColor" height="5" width="5" x="80" y="40" />
      <rect fill="currentColor" height="5" width="5" x="90" y="35" />
      <rect fill="currentColor" height="5" width="5" x="75" y="50" />
      <rect fill="currentColor" height="5" width="5" x="85" y="55" />
      <rect fill="currentColor" height="5" width="5" x="70" y="60" />
      <rect fill="currentColor" height="5" width="5" x="90" y="60" />

      {/* Bottom pattern */}
      <rect fill="currentColor" height="5" width="5" x="35" y="70" />
      <rect fill="currentColor" height="5" width="5" x="45" y="75" />
      <rect fill="currentColor" height="5" width="5" x="55" y="70" />
      <rect fill="currentColor" height="5" width="5" x="40" y="85" />
      <rect fill="currentColor" height="5" width="5" x="50" y="90" />
      <rect fill="currentColor" height="5" width="5" x="60" y="85" />

      <rect fill="currentColor" height="5" width="5" x="70" y="75" />
      <rect fill="currentColor" height="5" width="5" x="80" y="80" />
      <rect fill="currentColor" height="5" width="5" x="90" y="75" />
      <rect fill="currentColor" height="5" width="5" x="75" y="90" />
      <rect fill="currentColor" height="5" width="5" x="85" y="85" />
    </svg>
  );
}

export function TopicsSidebar({ topics, onNewChat }: TopicsSidebarProps) {
  return (
    <aside className="flex h-screen w-72 flex-col border-r">
      <div className="flex gap-2 border-b p-3">
        <Button onClick={onNewChat}>New chat</Button>
      </div>

      {/* QR Code Section */}
      <div className="flex flex-col items-center gap-3 border-b p-4">
        <div className="rounded-lg border bg-white p-2">
          <QRCodeMockup />
        </div>
        <p className="text-center text-muted-foreground text-sm">
          Connect with Loyal miniapp
        </p>
      </div>

      <ScrollArea className="flex-1">
        {topics.length === 0 ? (
          <div className="p-4 text-muted-foreground text-sm">
            Recent chats are no longer persisted in the desktop app.
          </div>
        ) : (
          <ul className="p-2">
            {topics.map((t) => (
              <li className="rounded px-2 py-1" key={t.id}>
                <div className="truncate font-medium">{t.title}</div>
                <div className="text-muted-foreground text-xs">
                  {new Date(t.updatedAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </aside>
  );
}
