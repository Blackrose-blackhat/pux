import { Hero } from "../components/Hero";
import { Terminal } from "../components/Terminal";
import { Integrations } from "../components/Integrations";
import { Problem } from "../components/Problem";
import { HowItWorks } from "../components/HowItWorks";
import { Features } from "../components/Features";
import { Agents } from "../components/Agents";
import { Install } from "../components/Install";
import { Footer } from "../components/Footer";

export default function Home() {
  return (
    <main>
      <Hero />
      <Terminal />
      <Integrations />
      <Problem />
      <HowItWorks />
      <Features />
      <Agents />
      <Install />
      <Footer />
    </main>
  );
}
