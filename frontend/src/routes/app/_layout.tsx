import {
  createFileRoute,
  Outlet,
  useMatches,
  Link,
} from '@tanstack/react-router'
import { StackedLayout } from '../../ui/stacked-layout'
import {
  Navbar,
  NavbarItem,
  NavbarSection,
  NavbarSpacer,
} from '../../ui/navbar'
import { UserButton, useOrganization } from '@clerk/clerk-react'
import { EnvelopeIcon } from '@heroicons/react/16/solid'

export const Route = createFileRoute('/app/_layout')({
  component: AppLayout,
})

const allNavItems = [
  { label: 'Send', to: '/app/send', match: '/app/_layout/send/', adminOnly: false },
  {
    label: 'Schedule',
    to: '/app/schedule',
    match: '/app/_layout/schedule/',
    adminOnly: false,
  },
  {
    label: 'Contacts',
    to: '/app/contacts',
    match: '/app/_layout/contacts/',
    adminOnly: false,
  },
  {
    label: 'Groups',
    to: '/app/groups',
    match: '/app/_layout/groups/',
    adminOnly: false,
  },
  {
    label: 'Import',
    to: '/app/import',
    match: '/app/_layout/import/',
    adminOnly: false,
  },
  {
    label: 'Templates',
    to: '/app/templates',
    match: '/app/_layout/templates/',
    adminOnly: false,
  },
  { label: 'Summary', to: '/app/summary', match: '/app/_layout/summary', adminOnly: false },
  { label: 'Users', to: '/app/users', match: '/app/_layout/users/', adminOnly: true },
  { label: 'Billing', to: '/app/billing', match: '/app/_layout/billing/', adminOnly: true },
]

function AppLayout() {
  const matches = useMatches()
  const { membership } = useOrganization()
  const isAdmin = membership?.role === 'org:admin'

  const navItems = allNavItems.filter((item) => {
    if (item.label === 'Import') {
      return import.meta.env.VITE_IMPORT_ENABLED === 'true'
    }
    if (item.adminOnly) {
      return isAdmin
    }
    return true
  })

  return (
    <StackedLayout
      navbar={
        <Navbar className="max-w-6xl m-auto">
          <Link to="/app/schedule" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-purple">
              <span className="text-sm font-semibold text-white font-mono">1</span>
            </div>
            <span className="text-lg font-semibold text-zinc-950 dark:text-white font-mono tracking-tight">1Reach</span>
          </Link>
          <NavbarSection className="">
            {navItems.map(({ label, to }) => (
              <NavbarItem
                key={label}
                to={to as any}
                current={matches.some((m) =>
                  m.pathname.startsWith(to),
                )}
              >
                {label}
              </NavbarItem>
            ))}
          </NavbarSection>
          <NavbarSpacer />
          <NavbarItem
            aria-label="Contact Support"
            onClick={() => {
              window.location.href = 'mailto:support@1ai.net.au?subject=' + encodeURIComponent('1Reach Support Request')
            }}
          >
            <EnvelopeIcon data-slot="icon" />
            Support
          </NavbarItem>
          <UserButton afterSignOutUrl="/" />
        </Navbar>
      }
      sidebar={null}
    >
      <Outlet />
    </StackedLayout>
  )
}
