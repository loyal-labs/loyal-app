import Image from "next/image"
import { LoginForm } from "@/components/login-form"
import { ADMIN_SESSION_COOKIE, isSafeNextPath, verifySessionToken } from "@/lib/admin-auth"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string | string[]
    error?: string | string[]
  }>
}

function toSingleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const nextPathValue = toSingleValue(resolvedSearchParams.next)
  const errorValue = toSingleValue(resolvedSearchParams.error)
  const safeNextPath = isSafeNextPath(nextPathValue) ? nextPathValue : undefined
  const nextPath = safeNextPath === "/" ? "/overview" : safeNextPath

  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value
  const session = await verifySessionToken(sessionToken)

  if (session) {
    redirect(nextPath ?? "/overview")
  }

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Image
          src="/sidebar-brand.svg"
          alt="Loyal"
          width={140}
          height={28}
          className="h-7 w-auto self-center"
          priority
        />
        <LoginForm hasError={errorValue === "invalid"} nextPath={nextPath} />
      </div>
    </div>
  )
}
