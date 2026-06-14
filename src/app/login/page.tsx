export const metadata = {
  title: 'Logga in · Gemensams',
}

interface LoginPageProps {
  searchParams: Promise<{ from?: string; error?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { from, error } = await searchParams

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-slate-50 dark:bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <span className="text-2xl font-bold tracking-tight text-foreground">
            Gemensams
          </span>
          <p className="text-sm text-muted-foreground text-center">
            Ange lösenordet för att komma åt hushållets ekonomi.
          </p>
        </div>

        <form
          action="/api/auth/login"
          method="POST"
          className="bg-white dark:bg-card border rounded-xl shadow-sm p-6 space-y-4"
        >
          {from && (
            <input type="hidden" name="from" value={from} />
          )}

          <div className="space-y-1">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-foreground"
            >
              Lösenord
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 font-medium">
              Fel lösenord. Försök igen.
            </p>
          )}

          <button
            type="submit"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 py-2 px-4 rounded-md text-sm font-medium transition-colors"
          >
            Logga in
          </button>
        </form>
      </div>
    </main>
  )
}
