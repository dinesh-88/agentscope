import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const token = (await cookies()).get("agentscope_jwt")?.value;
  const nextPath = (await searchParams)?.next;

  if (token) {
    redirect(nextPath || "/dashboard");
  }

  return <LoginForm nextPath={nextPath} />;
}
