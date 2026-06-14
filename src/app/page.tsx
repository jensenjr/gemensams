import { redirect } from 'next/navigation'

// Redirect the root to the single household group.
// All traffic goes straight to Hushållet — no multi-group landing page.
export default function HomePage() {
  redirect('/groups/hushallet')
}
