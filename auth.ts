import { createClient } from '@/lib/supabase/server'

const auth = async () => {
  const supabase = createClient()

  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    return null
  }
  return data
}

export { auth }
