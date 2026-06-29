import { Nav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { ProblemSection } from "@/components/landing/problem-section";
import { ConnectPlatforms } from "@/components/landing/connect-platforms";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ProductDashboard } from "@/components/landing/product-dashboard";
import { ReportSection } from "@/components/landing/report-section";
import { SecuritySection } from "@/components/landing/security-section";
import { UseCases } from "@/components/landing/use-cases";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <ProblemSection />
        <ConnectPlatforms />
        <HowItWorks />
        <ProductDashboard />
        <ReportSection />
        <SecuritySection />
        <UseCases />
      </main>
    </>
  );
}
