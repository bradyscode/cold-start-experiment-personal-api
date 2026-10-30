import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {path}
  </svg>
);

const tabs = [
  { to: '/', label: 'Feed', end: true, icon: icon(<path d="M4 6h16M4 12h16M4 18h10" />) },
  { to: '/dashboards', label: 'Dashboards', end: false, icon: icon(<path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />) },
  {
    to: '/compare',
    label: 'Compare',
    end: false,
    icon: icon(
      <>
        <path d="M3 17l5-6 4 3 6-8 3 3" />
        <path d="M3 21h18" />
      </>,
    ),
  },
  { to: '/add', label: 'Add', end: false, icon: icon(<path d="M12 5v14M5 12h14" />) },
  {
    to: '/settings',
    label: 'Settings',
    end: false,
    icon: icon(
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
      </>,
    ),
  },
];

export function TabBar() {
  return (
    <nav aria-label="Main" className="tabbar">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className="tab">
          {t.icon}
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
