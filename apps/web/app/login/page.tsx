import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { UI_SESSION_COOKIE_NAME } from "@/lib/api";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const token = (await cookies()).get(UI_SESSION_COOKIE_NAME)?.value;
  const nextPath = (await searchParams)?.next;

  if (token) {
    redirect(nextPath || "/dashboard");
  }

  return <LoginForm nextPath={nextPath} />;
}
