import { type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Package, Calendar, ArrowRightLeft, Boxes, Camera, BarChart3, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Package;
}

// Bottom nav (phone): the 6 things kitchen ops do. Plan was missing before so
// Brenda had no way to know what to grab. Reports lives in the desktop top bar
// only since admins use it on a real screen.
const NAV: NavItem[] = [
  { href: '/',         label: 'Inventory', icon: Boxes },
  { href: '/plan',     label: 'Plan',      icon: Calendar },
  { href: '/transfer', label: 'Stage',     icon: ArrowRightLeft },
  { href: '/log',      label: 'Log',       icon: ClipboardList },
  { href: '/receive',  label: 'Receive',   icon: Package },
  { href: '/photos',   label: 'Photos',    icon: Camera },
];

// Desktop top bar adds Plan + Reports.
const DESKTOP_NAV: NavItem[] = [
  { href: '/',         label: 'Inventory', icon: Boxes },
  { href: '/log',      label: 'Log',       icon: ClipboardList },
  { href: '/plan',     label: 'Plan',      icon: Calendar },
  { href: '/transfer', label: 'Stage',     icon: ArrowRightLeft },
  { href: '/receive',  label: 'Receive',   icon: Package },
  { href: '/photos',   label: 'Photos',    icon: Camera },
  { href: '/reports',  label: 'Reports',   icon: BarChart3 },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SyncBanner />
      <main className="flex-1 overflow-y-auto pb-24 md:pb-4">{children}</main>
      <BottomNav />
    </div>
  );
}

function SyncBanner() {
  const [location] = useLocation();
  return (
    <div className="safe-top sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-xs font-medium text-muted-foreground">Online</span>
          <span className="ml-2 hidden text-sm font-semibold tracking-wide text-foreground md:inline">
            Film Tracker
          </span>
        </div>

        {/* Desktop nav: visible md+ only */}
        <nav className="hidden md:flex md:items-center md:gap-1" aria-label="Primary desktop">
          {DESKTOP_NAV.map(item => {
            const active =
              location === item.href || (item.href !== '/' && location.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                data-testid={`top-nav-${item.label.toLowerCase()}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Phone: just the title, right side */}
        <span className="text-xs font-semibold tracking-wide text-foreground md:hidden">
          Film Tracker
        </span>
      </div>
    </div>
  );
}

function BottomNav() {
  const [location] = useLocation();
  return (
    <nav
      className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 backdrop-blur-md md:hidden"
      role="navigation"
      aria-label="Primary mobile"
    >
      <ul className="grid grid-cols-6">
        {NAV.map(item => {
          // For mobile bottom nav: '/log' tab should also light up on '/log/:rollId'.
          const active =
            location === item.href ||
            (item.href !== '/' && location.startsWith(item.href + '/')) ||
            (item.href !== '/' && location === item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  'flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-[10px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <Icon className={cn('h-5 w-5', active && 'stroke-[2.5]')} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
