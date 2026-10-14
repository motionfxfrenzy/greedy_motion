import { Suspense } from "react";
import { AuthPage } from "../../components/auth-page";

export default function Auth() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--d-bg-ebf5ff)" }} />}>
      <AuthPage />
    </Suspense>
  );
}
