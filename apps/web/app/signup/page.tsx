import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { UI_SESSION_COOKIE_NAME } from "@/lib/api";

export default async function SignupPage() {
  const token = (await cookies()).get(UI_SESSION_COOKIE_NAME)?.value;

  if (token) {
    redirect("/dashboard");
  }

  return <LoginForm initialMode="register" />;
}
