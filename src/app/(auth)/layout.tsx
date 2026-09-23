import { Providers } from "@/components/providers";

/**
 * (auth) group layout — login + welcome share the root session Providers so
 * AuthModal can call `refresh()` after signing in, and the welcome page can
 * bounce already-signed-in visitors to the app.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      {children}
    </Providers>
  );
}
