import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Package, Calendar, ArrowRightLeft, Boxes, Camera, BarChart3, ClipboardList, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore, activePlan, flavorRunway } from '@/store/store';

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

// Desktop top bar adds Plan + Reports + Orders.
const DESKTOP_NAV: NavItem[] = [
  { href: '/',         label: 'Inventory', icon: Boxes },
  { href: '/log',      label: 'Log',       icon: ClipboardList },
  { href: '/plan',     label: 'Plan',      icon: Calendar },
  { href: '/transfer', label: 'Stage',     icon: ArrowRightLeft },
  { href: '/receive',  label: 'Receive',   icon: Package },
  { href: '/orders',   label: 'Orders',    icon: ShoppingCart },
  { href: '/photos',   label: 'Photos',    icon: Camera },
  { href: '/reports',  label: 'Reports',   icon: BarChart3 },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Reset scroll on every route change. Without this, navigating from a
  // long Stage screen to Log lands you at the bottom of the new page.
  // Both window and the scrolling <main> need to be reset since either can
  // be the active scroller depending on viewport.
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTo({ top: 0, behavior: 'auto' });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location]);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SyncBanner />
      <main ref={mainRef} className="flex-1 overflow-y-auto pb-24 md:pb-4">{children}</main>
      <BottomNav />
    </div>
  );
}

function SyncBanner() {
  const [location] = useLocation();
  const { state } = useStore();
  const plan = activePlan(state);
  const planDate = plan ? fmtBannerDate(plan.week_of) : null;
  const planFull = plan ? fmtFullDate(plan.week_of) : null;

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

        <div className="flex items-center gap-2">
          {planDate && (
            <span
              className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-3 py-1 text-sm font-bold tracking-wide text-primary"
              data-testid="chip-production-date-desktop"
              title="Active production date"
            >
              <Calendar className="h-4 w-4" />
              <span>{planFull}</span>
            </span>
          )}
          {/* Phone: just the title, right side */}
          <span className="text-xs font-semibold tracking-wide text-foreground md:hidden">
            Film Tracker
          </span>
        </div>
      </div>

      {/* Big production date row, visible on phone. Brenda needs to see this
          fast and hard — small chips were getting missed. */}
      {planDate && (
        <div
          className="flex items-center justify-center gap-2 border-t border-primary/20 bg-primary/10 px-4 py-2 md:hidden"
          data-testid="banner-production-date"
        >
          <Calendar className="h-5 w-5 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
            Producing
          </span>
          <span className="text-base font-bold tracking-wide text-primary">
            {planFull}
          </span>
        </div>
      )}

      <RunwayBanner />
    </div>
  );
}

// Inventory-style alert for any flavor under 4 weeks of runway. Visible on
// every page so Steven cannot miss a stockout window. Hidden when no flavors
// trigger so it doesn't add noise.
function RunwayBanner() {
  const { state } = useStore();
  const triggered = flavorRunway(state).filter(r => r.triggers);
  if (triggered.length === 0) return null;
  const top = [...triggered].sort((a, b) => a.weeks - b.weeks).slice(0, 3);
  return (
    <Link
      href="/orders"
      className="flex items-center gap-2 border-t border-amber-500/30 bg-amber-500/10 px-4 py-2 text-amber-200 hover:bg-amber-500/15"
      data-testid="banner-runway-alert"
    >
      <ShoppingCart className="h-4 w-4 flex-shrink-0" />
      <span className="text-xs font-semibold uppercase tracking-wider">
        Order soon
      </span>
      <span className="truncate text-xs font-medium">
        {top.map(t => `${t.flavor.name} (${t.weeks.toFixed(1)}w)`).join(' · ')}
        {triggered.length > top.length ? ` · +${triggered.length - top.length}` : ''}
      </span>
    </Link>
  );
}

function fmtFullDate(s: string): string {
  const d = s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtBannerDate(s: string): string {
  const d = s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
