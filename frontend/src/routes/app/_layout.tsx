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
import logo from '../../assets/images/1ai_logo.png'

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
          <Link to="/app/schedule">
            <img
              src={logo}
              alt="Logo"
              width={55}
              height={55}
            />
          </Link>
          <NavbarSection className="">
            {navItems.map(({ label, to }) => (
              <NavbarItem
                key={label}
                to={to}
                current={matches.some((m) =>
                  m.pathname.startsWith(to),
                )}
              >
                {label}
              </NavbarItem>
            ))}
          </NavbarSection>
          <NavbarSpacer />
          <UserButton afterSignOutUrl="/" />
        </Navbar>
      }
      sidebar={null}
    >
      <Outlet />
    </StackedLayout>
  )
}
