import Link from "next/link";

const navigation = [
  { href: "/", label: "Overview", icon: "grid" },
  { href: "/leads", label: "Leads", icon: "users" },
  { href: "/calls", label: "Calls", icon: "phone" },
  { href: "/callbacks", label: "Callbacks", icon: "clock" },
  { href: "/automations", label: "Automations", icon: "bolt" },
];

export function DashboardShell({
  active,
  eyebrow,
  title,
  description,
  children,
}: {
  active: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="dashboard-frame">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">VS</span>
          <span>Voice Sales</span>
        </Link>
        <p className="sidebar-label">Workspace</p>
        <nav className="nav-list" aria-label="Main navigation">
          {navigation.map((item) => (
            <Link className={`nav-item ${active === item.label ? "active" : ""}`} href={item.href} key={item.href}>
              <NavIcon name={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" /> Agent online
          <small>LiveKit runtime</small>
        </div>
      </aside>
      <main className="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p className="page-description">{description}</p>
          </div>
          <div className="header-meta"><span className="pulse" /> Internal workspace</div>
        </header>
        {children}
      </main>
    </div>
  );
}

export function SectionHeading({ title, count }: { title: string; count?: number }) {
  return <div className="section-heading"><h2>{title}</h2>{count !== undefined && <span className="count-pill">{count}</span>}</div>;
}

export function StatusBadge({ value }: { value: string }) {
  return <span className={`status-badge status-${value.toLowerCase()}`}>{value.replaceAll("_", " ")}</span>;
}

export function EmptyState({ message }: { message: string }) {
  return <div className="empty-state"><span className="empty-icon">—</span><p>{message}</p></div>;
}

export function ErrorState() {
  return <div className="empty-state error-state"><span className="empty-icon">!</span><p>Data is temporarily unavailable. Check the database connection and try again.</p></div>;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92z",
    clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
    bolt: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
