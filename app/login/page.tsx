import type { Metadata } from "next";
import { LoginScreen } from "@/components/LoginScreen";

export const metadata: Metadata = { title: "Sign in — MogMine" };

// #182: with `supabase`, AuthGate renders the login screen itself on /login. With local or mock, this page renders
// through AppShell and LoginScreen shows the "sign-in is off" message.
export default function LoginPage() {
  return <LoginScreen />;
}
