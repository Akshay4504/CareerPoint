import { AdaptiveLayout } from "@/components/adaptive";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AdaptiveLayout>{children}</AdaptiveLayout>;
}
