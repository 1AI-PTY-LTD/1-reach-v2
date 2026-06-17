import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import GroupsModal from '../GroupsModal'
import { renderWithProviders } from '../../../test/test-utils'
import { server } from '../../../test/handlers'

// Mock toasts (see test/setup lessons) so we can assert success/error surfacing.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { toast } from 'sonner'

const BASE_URL = 'http://localhost:8000'

describe('GroupsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const baseProps = {
    isOpen: true,
    setIsOpen: vi.fn(),
  }

  describe('create mode (no groupId)', () => {
    it('renders the create heading and create button', () => {
      renderWithProviders(<GroupsModal {...baseProps} />)

      expect(screen.getByText('Create New Group')).toBeInTheDocument()
      expect(screen.getByText('Create Group')).toBeInTheDocument()
    })

    it('renders empty name and description fields', () => {
      renderWithProviders(<GroupsModal {...baseProps} />)

      expect(screen.getByPlaceholderText('Group name')).toHaveValue('')
      expect(screen.getByPlaceholderText('Group description')).toHaveValue('')
    })

    it('lets the user type into the name and description fields', async () => {
      const user = userEvent.setup()
      renderWithProviders(<GroupsModal {...baseProps} />)

      const nameInput = screen.getByPlaceholderText('Group name')
      const descInput = screen.getByPlaceholderText('Group description')

      await user.type(nameInput, 'My New Group')
      await user.type(descInput, 'Some description')

      expect(nameInput).toHaveValue('My New Group')
      expect(descInput).toHaveValue('Some description')
    })

    it('submits the create mutation and surfaces success', async () => {
      const setIsOpen = vi.fn()
      const onGroupCreated = vi.fn()
      const user = userEvent.setup()

      // Capture the POST body to assert the mutation is called with the typed name.
      let postedBody: Record<string, unknown> | null = null
      server.use(
        http.post(`${BASE_URL}/api/groups/`, async ({ request }) => {
          postedBody = (await request.json()) as Record<string, unknown>
          return HttpResponse.json(
            { id: 100, name: postedBody.name, description: postedBody.description, is_active: true, member_count: 0, created_at: '', updated_at: '' },
            { status: 201 },
          )
        }),
      )

      renderWithProviders(
        <GroupsModal isOpen={true} setIsOpen={setIsOpen} onGroupCreated={onGroupCreated} />,
      )

      await user.type(screen.getByPlaceholderText('Group name'), 'Marketing')
      await user.click(screen.getByText('Create Group'))

      await waitFor(() => {
        expect(setIsOpen).toHaveBeenCalledWith(false)
      })

      expect(postedBody).toMatchObject({ name: 'Marketing' })
      expect(toast.success).toHaveBeenCalledWith('Group created')
      expect(onGroupCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: 100, name: 'Marketing' }),
      )
    })

    it('surfaces an error when the create mutation fails', async () => {
      const setIsOpen = vi.fn()
      const user = userEvent.setup()

      server.use(
        http.post(`${BASE_URL}/api/groups/`, () =>
          HttpResponse.json({ error: 'boom' }, { status: 500 }),
        ),
      )

      renderWithProviders(<GroupsModal isOpen={true} setIsOpen={setIsOpen} />)

      await user.type(screen.getByPlaceholderText('Group name'), 'Will Fail')
      await user.click(screen.getByText('Create Group'))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to create group')
      })

      // On error the modal stays open.
      expect(setIsOpen).not.toHaveBeenCalledWith(false)
    })
  })

  describe('edit mode (groupId provided)', () => {
    it('renders the edit heading and update button', async () => {
      renderWithProviders(<GroupsModal {...baseProps} groupId={1} />)

      expect(screen.getByText('Edit Group')).toBeInTheDocument()

      // Once existing data loads, the update button is shown.
      await waitFor(() => {
        expect(screen.getByText('Update Group')).toBeInTheDocument()
      })
    })

    it('pre-fills the form with the existing group data', async () => {
      // MSW group-by-id handler returns the first seeded group ("VIP Customers").
      renderWithProviders(<GroupsModal {...baseProps} groupId={1} />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('VIP Customers')).toBeInTheDocument()
      })
    })

    it('submits the update mutation and surfaces success', async () => {
      const setIsOpen = vi.fn()
      const user = userEvent.setup()

      let putBody: Record<string, unknown> | null = null
      server.use(
        http.put(`${BASE_URL}/api/groups/:id/`, async ({ request }) => {
          putBody = (await request.json()) as Record<string, unknown>
          return HttpResponse.json({
            id: 1,
            name: putBody.name,
            description: putBody.description,
            is_active: true,
            member_count: 3,
            created_at: '',
            updated_at: '',
          })
        }),
      )

      renderWithProviders(<GroupsModal isOpen={true} setIsOpen={setIsOpen} groupId={1} />)

      // Wait for the existing group to load into the field.
      const nameInput = await screen.findByDisplayValue('VIP Customers')

      await user.clear(nameInput)
      await user.type(nameInput, 'VIP Renamed')
      await user.click(screen.getByText('Update Group'))

      await waitFor(() => {
        expect(setIsOpen).toHaveBeenCalledWith(false)
      })

      expect(putBody).toMatchObject({ name: 'VIP Renamed' })
      expect(toast.success).toHaveBeenCalledWith('Group updated')
    })

    it('surfaces an error when the update mutation fails', async () => {
      const setIsOpen = vi.fn()
      const user = userEvent.setup()

      server.use(
        http.put(`${BASE_URL}/api/groups/:id/`, () =>
          HttpResponse.json({ error: 'boom' }, { status: 500 }),
        ),
      )

      renderWithProviders(<GroupsModal isOpen={true} setIsOpen={setIsOpen} groupId={1} />)

      const nameInput = await screen.findByDisplayValue('VIP Customers')
      await user.clear(nameInput)
      await user.type(nameInput, 'VIP Renamed')
      await user.click(screen.getByText('Update Group'))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to update group')
      })

      expect(setIsOpen).not.toHaveBeenCalledWith(false)
    })
  })

  describe('cancel + closed states', () => {
    it('calls setIsOpen(false) when Cancel is clicked', async () => {
      const setIsOpen = vi.fn()
      const user = userEvent.setup()

      renderWithProviders(<GroupsModal isOpen={true} setIsOpen={setIsOpen} />)

      await user.click(screen.getByText('Cancel'))
      expect(setIsOpen).toHaveBeenCalledWith(false)
    })

    it('does not render the dialog content when isOpen is false', () => {
      renderWithProviders(<GroupsModal isOpen={false} setIsOpen={vi.fn()} />)
      expect(screen.queryByText('Create New Group')).not.toBeInTheDocument()
    })
  })
})
