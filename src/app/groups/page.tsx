import { redirect } from 'next/navigation'

// The app has a single household — skip the groups list.
export default function GroupsPage() {
  redirect('/groups/hushallet')
}
