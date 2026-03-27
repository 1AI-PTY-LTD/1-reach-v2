import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Text } from '../../ui/text'
import { Divider } from '../../ui/divider'
import { Button } from '../../ui/button'
import { PencilIcon } from '@heroicons/react/16/solid'
import { Heading } from '../../ui/heading'
import { useSuspenseQuery } from '@tanstack/react-query'
import { getTemplateByIdQueryOptions } from '../../api/templatesApi'
import { useApiClient } from '../../lib/ApiClientProvider'
import RouteErrorComponent from '../../components/shared/RouteErrorComponent'

export const Route = createFileRoute('/app/_layout/templates/$templateId')({
  component: TemplateDetails,
  params: {
    parse: (params) => ({
      templateId: z.coerce.number().int().parse(params.templateId),
    }),
    stringify: ({ templateId }) => ({ templateId: `${templateId}` }),
  },
  errorComponent: RouteErrorComponent,
})

function TemplateDetails() {
  const { templateId } = Route.useParams()
  const client = useApiClient()
  const templateQuery = useSuspenseQuery(
    getTemplateByIdQueryOptions(client, templateId),
  )
  const template = templateQuery.data

  return (
    <div className="border rounded-lg p-4 border-zinc-950/10 dark:border-white/10">
      <Heading>Template Name: {template.name}</Heading>
      <br />
      <Text>{template.text}</Text>
      <br />
      <Divider />
      <div className="flex justify-end mt-4">
        <Button color="light">
          <PencilIcon />
          Edit
        </Button>
      </div>
    </div>
  )
}
