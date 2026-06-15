'use client'

import { accountFormSchema, AccountKind } from '@/lib/accounts'
import { groupFormSchema } from '@/lib/schemas'
import { trpc } from '@/trpc/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
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

const GROUP_ID = 'hushallet'
const TOTAL_STEPS = 5

/* ─── Participant type ─── */
interface Participant {
  id?: string
  name: string
}

/* ─── Step indicator ─── */
function StepIndicator({ current, total }: { current: number; total: number }) {
  const t = useTranslations('Onboarding')
  return (
    <div className="flex flex-col gap-2 mb-6">
      <p className="text-xs text-muted-foreground text-center">
        {t('stepOf', { current, total })}
      </p>
      <div className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < current
                ? 'bg-emerald-600'
                : 'bg-slate-200 dark:bg-slate-700'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

/* ─── Skip-all button ─── */
function SkipAllButton({ onSkip }: { onSkip: () => void }) {
  const t = useTranslations('Onboarding')
  return (
    <button
      type="button"
      onClick={onSkip}
      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
    >
      {t('skipAll')}
    </button>
  )
}

/* ─── Props ─── */
interface WizardProps {
  initialName: string
  initialCurrency: string
  initialCurrencyCode: string
  initialParticipants: Participant[]
}

export function OnboardingWizard({
  initialName,
  initialCurrency,
  initialCurrencyCode,
  initialParticipants,
}: WizardProps) {
  const t = useTranslations('Onboarding')
  const router = useRouter()
  const [step, setStep] = useState(1)

  // Live data that flows between steps
  const [groupName, setGroupName] = useState(initialName)
  const [currency] = useState(initialCurrency)
  const [currencyCode] = useState(initialCurrencyCode)
  const [participants, setParticipants] =
    useState<Participant[]>(initialParticipants)

  const utils = trpc.useUtils()
  const updateMutation = trpc.groups.update.useMutation()
  const completeOnboardingMutation = trpc.groups.completeOnboarding.useMutation()
  const createAccountMutation = trpc.groups.accounts.create.useMutation()

  /* Finish: mark onboarded and redirect */
  const finish = async () => {
    await completeOnboardingMutation.mutateAsync({ groupId: GROUP_ID })
    await utils.groups.invalidate()
    router.push('/groups/hushallet')
  }

  /* Skip-all: still mark onboarded */
  const skipAll = async () => {
    await completeOnboardingMutation.mutateAsync({ groupId: GROUP_ID })
    router.push('/groups/hushallet')
  }

  /* ─── Step 1: Välkommen ─── */
  if (step === 1) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 flex flex-col gap-6">
        <StepIndicator current={1} total={TOTAL_STEPS} />
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{t('step1.title')}</CardTitle>
            <CardDescription className="text-base font-medium text-emerald-700 dark:text-emerald-400">
              {t('step1.tagline')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>{t('step1.description1')}</p>
            <p>{t('step1.description2')}</p>
            <p>{t('step1.description3')}</p>
          </CardContent>
          <CardFooter className="flex justify-between items-center">
            <SkipAllButton onSkip={skipAll} />
            <Button onClick={() => setStep(2)}>{t('step1.cta')}</Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  /* ─── Step 2: Hushåll ─── */
  if (step === 2) {
    return (
      <Step2Form
        initialName={groupName}
        participants={participants}
        onNext={async (name) => {
          // Persist group name update
          await updateMutation.mutateAsync({
            groupId: GROUP_ID,
            groupFormValues: {
              name,
              information: '',
              currency,
              currencyCode,
              participants,
            },
          })
          setGroupName(name)
          setStep(3)
        }}
        onSkipAll={skipAll}
      />
    )
  }

  /* ─── Step 3: Deltagare ─── */
  if (step === 3) {
    return (
      <Step3Form
        initialParticipants={participants}
        groupName={groupName}
        onNext={async (updatedParticipants) => {
          // Persist participant changes
          await updateMutation.mutateAsync({
            groupId: GROUP_ID,
            groupFormValues: {
              name: groupName,
              information: '',
              currency,
              currencyCode,
              participants: updatedParticipants,
            },
          })
          setParticipants(updatedParticipants)
          setStep(4)
        }}
        onBack={() => setStep(2)}
        onSkipAll={skipAll}
      />
    )
  }

  /* ─── Step 4: Konton ─── */
  if (step === 4) {
    return (
      <Step4Accounts
        participants={participants}
        onNext={() => setStep(5)}
        onSkip={() => setStep(5)}
        onBack={() => setStep(3)}
        onSkipAll={skipAll}
        createAccount={async (values) => {
          await createAccountMutation.mutateAsync({
            groupId: GROUP_ID,
            accountFormValues: values,
          })
        }}
      />
    )
  }

  /* ─── Step 5: Klar ─── */
  return (
    <div className="max-w-lg mx-auto px-4 py-12 flex flex-col gap-6">
      <StepIndicator current={5} total={TOTAL_STEPS} />
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t('step5.title')}</CardTitle>
          <CardDescription>{t('step5.description')}</CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-end">
          <Button
            onClick={finish}
            disabled={completeOnboardingMutation.isPending}
          >
            {t('step5.finish')}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

/* ══════════════════════════════════════════════════════ */
/* Step 2 sub-component                                    */
/* ══════════════════════════════════════════════════════ */
const step2Schema = z.object({ name: z.string().min(2).max(50) })
type Step2Values = z.infer<typeof step2Schema>

function Step2Form({
  initialName,
  participants,
  onNext,
  onSkipAll,
}: {
  initialName: string
  participants: Participant[]
  onNext: (name: string) => Promise<void>
  onSkipAll: () => void
}) {
  const t = useTranslations('Onboarding')
  const form = useForm<Step2Values>({
    resolver: zodResolver(step2Schema),
    defaultValues: { name: initialName },
  })

  return (
    <div className="max-w-lg mx-auto px-4 py-12 flex flex-col gap-6">
      <StepIndicator current={2} total={TOTAL_STEPS} />
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(async (values) => {
            await onNext(values.name)
          })}
        >
          <Card>
            <CardHeader>
              <CardTitle>{t('step2.title')}</CardTitle>
              <CardDescription>{t('step2.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('step2.nameLabel')}</FormLabel>
                    <FormControl>
                      <Input
                        className="text-base"
                        placeholder={t('step2.namePlaceholder')}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex justify-between items-center">
              <SkipAllButton onSkip={onSkipAll} />
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t('step2.next')}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </div>
  )
}

/* ══════════════════════════════════════════════════════ */
/* Step 3 sub-component                                    */
/* ══════════════════════════════════════════════════════ */
const step3Schema = z.object({
  participants: z
    .array(z.object({ id: z.string().optional(), name: z.string().min(2) }))
    .min(2, 'minError'),
})
type Step3Values = z.infer<typeof step3Schema>

function Step3Form({
  initialParticipants,
  groupName,
  onNext,
  onBack,
  onSkipAll,
}: {
  initialParticipants: Participant[]
  groupName: string
  onNext: (participants: Participant[]) => Promise<void>
  onBack: () => void
  onSkipAll: () => void
}) {
  const t = useTranslations('Onboarding')
  const form = useForm<Step3Values>({
    resolver: zodResolver(step3Schema),
    defaultValues: { participants: initialParticipants },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'participants',
    keyName: 'key',
  })

  return (
    <div className="max-w-lg mx-auto px-4 py-12 flex flex-col gap-6">
      <StepIndicator current={3} total={TOTAL_STEPS} />
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(async (values) => {
            await onNext(values.participants)
          })}
        >
          <Card>
            <CardHeader>
              <CardTitle>{t('step3.title')}</CardTitle>
              <CardDescription>{t('step3.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {fields.map((field, index) => (
                <div key={field.key} className="flex gap-2 items-start">
                  <FormField
                    control={form.control}
                    name={`participants.${index}.name`}
                    render={({ field: inputField }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input
                            className="text-base"
                            placeholder={t('step3.namePlaceholder')}
                            {...inputField}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive mt-0.5 shrink-0"
                    onClick={() => remove(index)}
                    disabled={fields.length <= 2}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {form.formState.errors.participants?.root && (
                <p className="text-sm text-destructive">
                  {t('step3.minError')}
                </p>
              )}
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                onClick={() => append({ name: '' })}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('step3.addParticipant')}
              </Button>
            </CardContent>
            <CardFooter className="flex justify-between items-center">
              <SkipAllButton onSkip={onSkipAll} />
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={onBack}>
                  Tillbaka
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {t('step3.next')}
                </Button>
              </div>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </div>
  )
}

/* ══════════════════════════════════════════════════════ */
/* Step 4 sub-component                                    */
/* ══════════════════════════════════════════════════════ */
type AccountFormValues = z.infer<typeof accountFormSchema>

function Step4Accounts({
  participants,
  onNext,
  onSkip,
  onBack,
  onSkipAll,
  createAccount,
}: {
  participants: Participant[]
  onNext: () => void
  onSkip: () => void
  onBack: () => void
  onSkipAll: () => void
  createAccount: (values: AccountFormValues) => Promise<void>
}) {
  const t = useTranslations('Onboarding')
  const tAccounts = useTranslations('Accounts')
  const [showForm, setShowForm] = useState(false)
  const [pendingAccounts, setPendingAccounts] = useState<
    { name: string; kind: string; ownerName?: string }[]
  >([])

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      name: '',
      kind: AccountKind.PERSONAL,
      ownerParticipantId: null,
      accountNumbers: [],
    },
  })

  const kind = form.watch('kind')

  const handleAddAccount = async (values: AccountFormValues) => {
    await createAccount(values)
    const ownerName = participants.find(
      (p) => p.id === values.ownerParticipantId,
    )?.name
    setPendingAccounts((prev) => [
      ...prev,
      { name: values.name, kind: values.kind, ownerName },
    ])
    form.reset()
    setShowForm(false)
  }

  const kindLabel = (kind: string) => {
    switch (kind) {
      case AccountKind.PERSONAL:
        return tAccounts('KindField.personal')
      case AccountKind.SHARED:
        return tAccounts('KindField.shared')
      case AccountKind.SAVINGS:
        return tAccounts('KindField.savings')
      default:
        return kind
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-12 flex flex-col gap-6">
      <StepIndicator current={4} total={TOTAL_STEPS} />
      <Card>
        <CardHeader>
          <CardTitle>{t('step4.title')}</CardTitle>
          <CardDescription>{t('step4.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pendingAccounts.length > 0 && (
            <ul className="flex flex-col gap-2">
              {pendingAccounts.map((acc, i) => (
                <li
                  key={i}
                  className="flex gap-2 items-center border rounded-lg px-3 py-2 text-sm"
                >
                  <span className="font-medium flex-1">{acc.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {kindLabel(acc.kind)}
                    {acc.ownerName ? ` · ${acc.ownerName}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {showForm ? (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(handleAddAccount)}
                className="flex flex-col gap-3 border rounded-lg p-4"
              >
                <div className="grid sm:grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tAccounts('NameField.label')}</FormLabel>
                        <FormControl>
                          <Input
                            className="text-base"
                            placeholder={tAccounts('NameField.placeholder')}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="kind"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tAccounts('KindField.label')}</FormLabel>
                        <Select
                          onValueChange={(v) => {
                            field.onChange(v)
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
                              {tAccounts('KindField.personal')}
                            </SelectItem>
                            <SelectItem value={AccountKind.SHARED}>
                              {tAccounts('KindField.shared')}
                            </SelectItem>
                            <SelectItem value={AccountKind.SAVINGS}>
                              {tAccounts('KindField.savings')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {kind === AccountKind.PERSONAL && (
                  <FormField
                    control={form.control}
                    name="ownerParticipantId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tAccounts('OwnerField.label')}</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value ?? ''}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={tAccounts('OwnerField.placeholder')}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {participants
                              .filter((p) => p.id)
                              .map((p) => (
                                <SelectItem key={p.id} value={p.id!}>
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

                <FormField
                  control={form.control}
                  name="accountNumbers"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {tAccounts('AccountNumbersField.label')}
                      </FormLabel>
                      <FormControl>
                        <Input
                          className="text-base"
                          placeholder={tAccounts(
                            'AccountNumbersField.placeholder',
                          )}
                          value={field.value.join(', ')}
                          onChange={(e) => {
                            const nums = e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean)
                            field.onChange(nums)
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      form.reset()
                      setShowForm(false)
                    }}
                  >
                    {tAccounts('cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={form.formState.isSubmitting}
                  >
                    {form.formState.isSubmitting
                      ? tAccounts('saving')
                      : tAccounts('save')}
                  </Button>
                </div>
              </form>
            </Form>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              onClick={() => setShowForm(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              {tAccounts('add')}
            </Button>
          )}
        </CardContent>
        <CardFooter className="flex justify-between items-center">
          <SkipAllButton onSkip={onSkipAll} />
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onBack}>
              Tillbaka
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onSkip}
            >
              {t('step4.skip')}
            </Button>
            <Button type="button" onClick={onNext}>
              {t('step4.next')}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
