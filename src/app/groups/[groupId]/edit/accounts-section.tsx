'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AccountKind } from '@/lib/accounts'
import { accountFormSchema } from '@/trpc/routers/groups/accounts/create.procedure'
import { trpc } from '@/trpc/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useCurrentGroup } from '../current-group-context'

type AccountFormValues = z.infer<typeof accountFormSchema>

interface Participant {
  id: string
  name: string
}

interface Account {
  id: string
  name: string
  kind: AccountKind
  ownerParticipantId: string | null
  accountNumbers: string[]
}

interface AccountFormProps {
  participants: Participant[]
  initialValues?: AccountFormValues & { id?: string }
  onSave: (values: AccountFormValues) => Promise<void>
  onCancel: () => void
}

function AccountForm({
  participants,
  initialValues,
  onSave,
  onCancel,
}: AccountFormProps) {
  const t = useTranslations('Accounts')
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: initialValues ?? {
      name: '',
      kind: AccountKind.PERSONAL,
      ownerParticipantId: null,
      accountNumbers: [],
    },
  })

  const kind = form.watch('kind')

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSave)}
        className="flex flex-col gap-3 border rounded-lg p-4"
      >
        <div className="grid sm:grid-cols-2 gap-3">
          {/* Name */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('NameField.label')}</FormLabel>
                <FormControl>
                  <Input
                    className="text-base"
                    placeholder={t('NameField.placeholder')}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Kind */}
          <FormField
            control={form.control}
            name="kind"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('KindField.label')}</FormLabel>
                <Select
                  onValueChange={(v) => {
                    field.onChange(v)
                    // Clear ownerParticipantId when switching away from PERSONAL
                    if (v !== AccountKind.PERSONAL) {
                      form.setValue('ownerParticipantId', null)
                    }
                  }}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={AccountKind.PERSONAL}>
                      {t('KindField.personal')}
                    </SelectItem>
                    <SelectItem value={AccountKind.SHARED}>
                      {t('KindField.shared')}
                    </SelectItem>
                    <SelectItem value={AccountKind.SAVINGS}>
                      {t('KindField.savings')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Owner — shown only for PERSONAL */}
        {kind === AccountKind.PERSONAL && (
          <FormField
            control={form.control}
            name="ownerParticipantId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('OwnerField.label')}</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? ''}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t('OwnerField.placeholder')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {participants.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Account numbers (comma-separated) */}
        <FormField
          control={form.control}
          name="accountNumbers"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('AccountNumbersField.label')}</FormLabel>
              <FormControl>
                <Input
                  className="text-base"
                  placeholder={t('AccountNumbersField.placeholder')}
                  value={field.value.join(', ')}
                  onChange={(e) => {
                    const raw = e.target.value
                    const nums = raw
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                    field.onChange(nums)
                  }}
                />
              </FormControl>
              <FormDescription>
                {t('AccountNumbersField.description')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
    </Form>
  )
}

interface Props {
  participants: Participant[]
}

export function AccountsSection({ participants }: Props) {
  const t = useTranslations('Accounts')
  const { groupId } = useCurrentGroup()
  const utils = trpc.useUtils()

  const { data, isLoading } = trpc.groups.accounts.list.useQuery({ groupId })
  const createMutation = trpc.groups.accounts.create.useMutation()
  const updateMutation = trpc.groups.accounts.update.useMutation()
  const deleteMutation = trpc.groups.accounts.delete.useMutation()

  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const accounts: Account[] = data?.accounts ?? []

  const invalidate = () => utils.groups.accounts.invalidate()

  const handleCreate = async (values: AccountFormValues) => {
    await createMutation.mutateAsync({ groupId, accountFormValues: values })
    await invalidate()
    setShowAddForm(false)
  }

  const handleUpdate = async (accountId: string, values: AccountFormValues) => {
    await updateMutation.mutateAsync({ accountId, accountFormValues: values })
    await invalidate()
    setEditingId(null)
  }

  const handleDelete = async (accountId: string) => {
    if (!confirm(t('deleteConfirm'))) return
    await deleteMutation.mutateAsync({ accountId })
    await invalidate()
  }

  const kindLabel = (kind: AccountKind) => {
    switch (kind) {
      case AccountKind.PERSONAL:
        return t('KindField.personal')
      case AccountKind.SHARED:
        return t('KindField.shared')
      case AccountKind.SAVINGS:
        return t('KindField.savings')
    }
  }

  const ownerName = (account: Account) => {
    if (account.kind !== AccountKind.PERSONAL) return null
    return participants.find((p) => p.id === account.ownerParticipantId)?.name
  }

  if (isLoading) return null

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {accounts.length === 0 && !showAddForm && (
          <p className="text-sm text-muted-foreground">{t('noAccounts')}</p>
        )}

        {accounts.map((account) =>
          editingId === account.id ? (
            <AccountForm
              key={account.id}
              participants={participants}
              initialValues={{
                name: account.name,
                kind: account.kind,
                ownerParticipantId: account.ownerParticipantId,
                accountNumbers: account.accountNumbers,
              }}
              onSave={(values) => handleUpdate(account.id, values)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div
              key={account.id}
              className="flex items-start justify-between gap-2 border rounded-lg p-3"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-medium truncate">{account.name}</span>
                <span className="text-sm text-muted-foreground">
                  {kindLabel(account.kind)}
                  {ownerName(account) ? ` · ${ownerName(account)}` : ''}
                </span>
                {account.accountNumbers.length > 0 && (
                  <span className="text-xs text-muted-foreground font-mono truncate">
                    {account.accountNumbers.join(', ')}
                  </span>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditingId(account.id)}
                >
                  <Pencil className="w-4 h-4" />
                  <span className="sr-only">{t('edit')}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => handleDelete(account.id)}
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="sr-only">{t('delete')}</span>
                </Button>
              </div>
            </div>
          ),
        )}

        {showAddForm ? (
          <AccountForm
            participants={participants}
            onSave={handleCreate}
            onCancel={() => setShowAddForm(false)}
          />
        ) : (
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('add')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
