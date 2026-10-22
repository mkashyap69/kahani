"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Inbox, LayoutDashboard, Palette, Settings, Tv, ListVideo, Rocket, Music, Images } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/review", label: "Review Queue", icon: Inbox },
  { href: "/content", label: "All Content", icon: ListVideo },
  { href: "/launch", label: "Launch Kit", icon: Rocket },
  { href: "/channels", label: "Channels", icon: Tv },
  { href: "/themes", label: "Themes", icon: Palette },
  { href: "/music", label: "Music", icon: Music },
  { href: "/compare", label: "Image Models", icon: Images },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r bg-card px-3 py-5 md:flex">
      <Link href="/" className="mb-6 flex items-center gap-2 px-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-pink-600 text-white">
          <Clapperboard className="h-5 w-5" />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-bold">Kahani Studio</span>
          <span className="deva block text-xs text-muted-foreground">कहानी स्टूडियो</span>
        </span>
      </Link>
      <nav className="space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                active ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <p className="mt-auto px-2 text-[11px] leading-snug text-muted-foreground">Every video is uploaded with YouTube&apos;s AI-content disclosure enabled.</p>
    </aside>
  );
}
