import type { ReactNode } from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Navbar />
      <div className="flex min-h-screen flex-col pt-16">
        <main className="flex-grow">{children}</main>
        <Footer />
      </div>
    </>
  );
}
